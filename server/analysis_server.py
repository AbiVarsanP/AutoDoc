from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import os
import uuid
import asyncio
from typing import Any, Dict

# Optional transformers imports (server still starts if missing)
try:
    from transformers import AutoTokenizer, AutoModelForCausalLM, AutoModelForSeq2SeqLM
    import torch
except Exception:
    AutoTokenizer = None
    AutoModelForCausalLM = None
    AutoModelForSeq2SeqLM = None
    torch = None

app = FastAPI(title="Code Analysis Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:5174", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration: model name can be overridden with env var ANALYSIS_MODEL_NAME
# Using flan-t5-small - lightweight and stable for code analysis
MODEL_NAME = os.environ.get("ANALYSIS_MODEL_NAME") or "google/flan-t5-small"

# Globals populated lazily
TOKENIZER = None
MODEL = None
MODEL_IS_SEQ2SEQ = False

# Job store for async analysis
JOBS: Dict[str, Dict[str, Any]] = {}


class AnalyzeRequest(BaseModel):
    code: str
    fileName: str = ""
    fileType: str = ""


def load_model():
    """Load tokenizer and model lazily. Raises RuntimeError if transformers not installed."""
    global TOKENIZER, MODEL, MODEL_IS_SEQ2SEQ
    if TOKENIZER is not None and MODEL is not None:
        return

    if AutoTokenizer is None:
        raise RuntimeError("transformers not installed in this environment")

    TOKENIZER = AutoTokenizer.from_pretrained(MODEL_NAME)

    # Prefer seq2seq models (T5/Flan) for instruction->text
    try:
        MODEL = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME)
        MODEL_IS_SEQ2SEQ = True
    except Exception:
        MODEL = AutoModelForCausalLM.from_pretrained(MODEL_NAME)
        MODEL_IS_SEQ2SEQ = False

    if torch is not None and torch.cuda.is_available():
        MODEL.to("cuda")


def blocking_inference(prompt: str) -> str:
    """Run model.generate synchronously. Intended to be called inside a threadpool."""
    # Ensure prompt is a string (not a list)
    if isinstance(prompt, list):
        prompt = " ".join(prompt)
    
    inputs = TOKENIZER(
        prompt,
        return_tensors="pt",
        max_length=512,
        truncation=True,
        padding=True
    )
    
    if torch is not None and torch.cuda.is_available():
        inputs = {k: v.cuda() for k, v in inputs.items()}

    outputs = MODEL.generate(
        **inputs,
        max_new_tokens=512,
        do_sample=False,
        num_beams=1
    )
    text = TOKENIZER.decode(outputs[0], skip_special_tokens=True)
    return text


async def run_analysis(code: str, filename: str):
    """Run the full analysis flow: generate text and try to parse JSON from model output."""
    
    # First, try to check syntax for Python files using ast
    errors = []
    warnings = []
    suggestions = []
    code_lines = code.split('\n')
    
    if filename.endswith(('.py', '.pyw')):
        import ast
        try:
            tree = ast.parse(code)
            
            # Check for undefined names (simple check)
            defined_names = set()
            used_names = {}  # mapping name -> line number
            
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
                    defined_names.add(node.name)
                elif isinstance(node, ast.Name):
                    if isinstance(node.ctx, ast.Store):
                        defined_names.add(node.id)
                    elif isinstance(node.ctx, ast.Load):
                        if hasattr(node, 'lineno'):
                            used_names[node.id] = node.lineno
            
            # Check for potential undefined references (excluding built-ins and common imports)
            builtins = {'print', 'len', 'str', 'int', 'list', 'dict', 'set', 'tuple', 'range', 'enumerate', 
                       'zip', 'map', 'filter', 'sum', 'max', 'min', 'abs', 'all', 'any', 'open', 'type',
                       'isinstance', 'issubclass', 'super', 'property', 'staticmethod', 'classmethod', 'True',
                       'False', 'None', 'Exception', 'ValueError', 'TypeError', 'KeyError', 'AttributeError'}
            undefined = set(used_names.keys()) - defined_names - builtins
            
            for name in undefined:
                if not name.startswith('_'):  # Skip private/dunder names
                    line_num = used_names.get(name, 0)
                    warnings.append({
                        "line": line_num,
                        "severity": "warning",
                        "message": f"Potentially undefined name: '{name}' - verify it's imported or defined elsewhere",
                        "code": code_lines[line_num - 1].strip() if 0 < line_num <= len(code_lines) else "N/A"
                    })
                    
        except SyntaxError as e:
            error_line = e.lineno or 0
            errors.append({
                "line": error_line,
                "severity": "error",
                "message": f"{e.msg}",
                "code": (code_lines[error_line - 1] if 0 < error_line <= len(code_lines) else e.text or "").strip()
            })
        except Exception as e:
            errors.append({
                "line": 0,
                "severity": "error",
                "message": f"Parse Error: {str(e)}",
                "code": "N/A"
            })
    
    # If we have syntax errors, return immediately without calling the model
    if errors:
        # Add helpful suggestions based on common error patterns
        for error in errors:
            msg = error.get("message", "").lower()
            if "unexpected eof" in msg or "invalid syntax" in msg:
                suggestions.append({
                    "line": 0,
                    "severity": "info",
                    "message": "Check for missing closing brackets, parentheses, or quotes",
                    "code": "N/A"
                })
            if "name" in msg and "defined" in msg:
                suggestions.append({
                    "line": 0,
                    "severity": "info",
                    "message": "Verify all imports are correct and variable names are spelled correctly",
                    "code": "N/A"
                })
        
        if not suggestions:
            suggestions.append({
                "line": 0,
                "severity": "info",
                "message": "Fix syntax errors before further analysis",
                "code": "N/A"
            })
            
        return {
            "errors": errors,
            "warnings": warnings,
            "suggestions": suggestions,
            "summary": f"Found {len(errors)} syntax error(s) that must be fixed"
        }
    
    # If no errors but have warnings, return them
    if warnings and not errors:
        return {
            "errors": [],
            "warnings": warnings,
            "suggestions": [
                {
                    "line": 0,
                    "severity": "info",
                    "message": "Code is syntactically correct. Review warnings for potential improvements.",
                    "code": "N/A"
                }
            ],
            "summary": f"No syntax errors found. {len(warnings)} potential issue(s) detected."
        }
    
    # If no issues found at all, return clean result
    if not errors and not warnings:
        return {
            "errors": [],
            "warnings": [],
            "suggestions": [
                {
                    "line": 0,
                    "severity": "info",
                    "message": "No obvious issues detected. Code appears syntactically correct.",
                    "code": "N/A"
                }
            ],
            "summary": "Static analysis complete: No issues found"
        }
    
    # Try to load model for deeper analysis, but don't fail if it doesn't work
    try:
        load_model()
    except Exception as model_error:
        # Model loading failed, but return the AST-based analysis we already have
        return {
            "errors": errors,
            "warnings": warnings,
            "suggestions": [{"line": 0, "severity": "info", "message": f"AI model unavailable, static analysis only", "code": "N/A"}],
            "summary": f"Basic analysis complete: {len(warnings)} potential issues found"
        }

    prompt = (
        f"Analyze this Python code for errors and issues:\n\n"
        f"```python\n{code}\n```\n\n"
        f"Check for:\n"
        f"- Syntax errors (missing parentheses, colons, commas, typos in names)\n"
        f"- Undefined variables or functions\n"
        f"- Logic errors\n"
        f"- Code quality issues\n\n"
        f"Return a JSON object only:\n"
        f'{{"issues": ["error 1", "error 2"], "warnings": ["warning 1"], "suggestions": ["tip 1"], "summary": "text"}}'
    )

    loop = asyncio.get_running_loop()
    try:
        text = await loop.run_in_executor(None, blocking_inference, prompt)
    except Exception as e:
        raise RuntimeError(f"Model inference failed: {e}")

    # Try to extract JSON from fences or balanced braces
    import json, re

    def extract_json_from_text(s: str):
        starts = [i for i, ch in enumerate(s) if ch == '{']
        for start in starts:
            depth = 0
            for i in range(start, len(s)):
                if s[i] == '{':
                    depth += 1
                elif s[i] == '}':
                    depth -= 1
                    if depth == 0:
                        candidate = s[start:i+1]
                        try:
                            return json.loads(candidate)
                        except Exception:
                            break
        return None

    fence_pattern = re.compile(r"```(?:json|python|py)?\n([\s\S]*?)```", re.IGNORECASE)
    fences = fence_pattern.findall(text)
    parsed = None
    for block in fences:
        try:
            parsed = json.loads(block)
            break
        except Exception:
            parsed = extract_json_from_text(block)
            if parsed is not None:
                break

    if parsed is None:
        parsed = extract_json_from_text(text)

    # Helper function to convert string items to structured format
    def to_structured_item(item, severity="info", default_line=0):
        """Convert a string or dict to the structured format frontend expects"""
        if isinstance(item, dict):
            # Already structured, ensure all keys exist
            return {
                "line": item.get("line", default_line),
                "severity": item.get("severity", severity),
                "message": item.get("message", str(item)),
                "code": item.get("code", "N/A")
            }
        else:
            # Convert string to structured format
            return {
                "line": default_line,
                "severity": severity,
                "message": str(item),
                "code": "N/A"
            }

    # If model doesn't return proper JSON, create a fallback structure
    if parsed is None or not isinstance(parsed, dict):
        model_errors = [] if not text else [{"line": 0, "severity": "info", "message": f"Model output: {text[:200]}...", "code": "N/A"}]
        return {
            "errors": errors + model_errors,
            "warnings": warnings,
            "suggestions": [{"line": 0, "severity": "info", "message": "Analysis incomplete - model did not return structured data", "code": "N/A"}],
            "summary": "Analysis incomplete - model did not return structured data"
        }
    
    # Convert model results to structured format
    model_errors = []
    model_warnings = []
    model_suggestions = []
    
    if "issues" in parsed:
        for item in parsed["issues"]:
            model_errors.append(to_structured_item(item, "error"))
    if "errors" in parsed:
        for item in parsed["errors"]:
            model_errors.append(to_structured_item(item, "error"))
    
    if "warnings" in parsed:
        for item in parsed["warnings"]:
            model_warnings.append(to_structured_item(item, "warning"))
    
    if "suggestions" in parsed:
        for item in parsed["suggestions"]:
            model_suggestions.append(to_structured_item(item, "info"))
    
    # Merge with static analysis results
    all_errors = errors + model_errors
    all_warnings = warnings + model_warnings
    all_suggestions = model_suggestions
    
    return {
        "errors": all_errors,
        "warnings": all_warnings,
        "suggestions": all_suggestions if all_suggestions else [{"line": 0, "severity": "info", "message": "No specific suggestions at this time", "code": "N/A"}],
        "summary": parsed.get("summary", f"Analysis complete: {len(all_errors)} errors, {len(all_warnings)} warnings")
    }


@app.post("/analyze")
async def analyze(req: AnalyzeRequest):
    if not req.code:
        raise HTTPException(status_code=400, detail="No code provided")

    try:
        result = await run_analysis(req.code, req.fileName)
        return {"analysis": result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze_async")
async def analyze_async(req: AnalyzeRequest):
    """Submit analysis job and return job id immediately."""
    if not req.code:
        raise HTTPException(status_code=400, detail="No code provided")

    job_id = str(uuid.uuid4())
    JOBS[job_id] = {"status": "pending", "result": None, "error": None}

    # schedule background task
    asyncio.create_task(_run_and_store(job_id, req.code, req.fileName))

    return {"job_id": job_id}


@app.get("/status/{job_id}")
async def job_status(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


async def _run_and_store(job_id: str, code: str, filename: str):
    try:
        JOBS[job_id]["status"] = "running"
        result = await run_analysis(code, filename)
        JOBS[job_id]["status"] = "done"
        JOBS[job_id]["result"] = result
    except Exception as e:
        JOBS[job_id]["status"] = "failed"
        JOBS[job_id]["error"] = str(e)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
