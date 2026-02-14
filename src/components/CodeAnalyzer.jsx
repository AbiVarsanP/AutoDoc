import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import SafeIcon from '../common/SafeIcon';
import * as FiIcons from 'react-icons/fi';
import axios from 'axios';
import { useProject } from '../context/ProjectContext';

const {
  FiFolder, FiCode, FiFile, FiSearch, FiCheck,
  FiAlertTriangle, FiX, FiEdit, FiSave, FiEye,
  FiChevronRight, FiChevronDown, FiRefreshCw, 
  FiFileText, FiGitBranch
} = FiIcons;

const CodeAnalyzer = () => {
  const { state } = useProject();
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [apiKey, setApiKey] = useState('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');
  const [error, setError] = useState('');
  const [selectedFilePath, setSelectedFilePath] = useState('');

  // Function to get file type based on extension
  const getFileType = (filename) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const typeMap = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'php': 'php',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'json': 'json',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'md': 'markdown',
      'txt': 'text'
    };
    return typeMap[ext] || 'text';
  };

  // Function to get file icon based on type
  const getFileIcon = (type) => {
    const iconMap = {
      'javascript': FiCode,
      'typescript': FiCode,
      'python': FiCode,
      'java': FiCode,
      'cpp': FiCode,
      'c': FiCode,
      'csharp': FiCode,
      'php': FiCode,
      'ruby': FiCode,
      'go': FiCode,
      'rust': FiCode,
      'swift': FiCode,
      'kotlin': FiCode,
      'scala': FiCode,
      'html': FiCode,
      'css': FiCode,
      'scss': FiCode,
      'json': FiFileText,
      'xml': FiFileText,
      'yaml': FiFileText,
      'markdown': FiFileText,
      'text': FiFileText,
      'folder': FiFolder
    };
    return iconMap[type] || FiFile;
  };

  // Helper: extract JSON by matching balanced braces
  const extractJsonFromText = (s) => {
    if (!s || typeof s !== 'string') return null;
    const starts = [];
    for (let i = 0; i < s.length; i++) if (s[i] === '{') starts.push(i);
    for (const start of starts) {
      let depth = 0;
      for (let i = start; i < s.length; i++) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') {
          depth--;
          if (depth === 0) {
            const candidate = s.slice(start, i + 1);
            try {
              return JSON.parse(candidate);
            } catch (e) {
              break;
            }
          }
        }
      }
    }
    return null;
  };

  // Helper: extract JSON from code fences (```json or ```python blocks)
  const extractJsonFromFences = (s) => {
    if (!s || typeof s !== 'string') return null;
    const fenceRegex = /```(?:json|python|py|txt)?\n([\s\S]*?)```/gi;
    let m;
    while ((m = fenceRegex.exec(s)) !== null) {
      const block = m[1].trim();
      try {
        return JSON.parse(block);
      } catch (e) {
        const parsed = extractJsonFromText(block);
        if (parsed) return parsed;
      }
    }
    return null;
  };

  // Function to fetch repository files
  const fetchRepositoryFiles = async () => {
    if (!state.currentProject) return;

    setIsLoadingFiles(true);
    setError('');

    try {
      const { owner, repo } = state.currentProject;
      const branch = state.currentProject.branch || 'main';
      // Prepare headers (use token if available)
      const headers = {
        Accept: 'application/vnd.github.v3+json',
        ...(state.githubToken ? { Authorization: `token ${state.githubToken}` } : {})
      };

      // Fetch all files recursively
      const allFiles = await fetchAllFiles(owner, repo, branch, '', headers);
      setFiles(allFiles);
      
    } catch (error) {
      console.error('Error fetching repository files:', error);
      setError(`Failed to fetch repository files: ${error.message}`);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  // Recursive function to fetch all files from repository
  // Use Git Trees API to list repository files quickly
  const fetchAllFiles = async (owner, repo, branch, path = '', headers) => {
    try {
      const apiHeaders = headers || {
        Accept: 'application/vnd.github.v3+json',
        ...(state.githubToken ? { Authorization: `token ${state.githubToken}` } : {})
      };

      // Get tree SHA for the branch
      const branchResp = await axios.get(`https://api.github.com/repos/${owner}/${repo}/branches/${branch}`, { headers: apiHeaders });
      const treeSha = branchResp.data?.commit?.commit?.tree?.sha;

      if (!treeSha) return [];

      const treeResp = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, { headers: apiHeaders });
      const tree = treeResp.data?.tree || [];

      const allFiles = [];
      for (const entry of tree) {
        if (entry.type === 'blob') {
          const name = entry.path.split('/').pop();
          if (isBinaryFile(name)) continue;
          if (entry.size && entry.size > 1000000) continue;

          allFiles.push({
            name,
            path: entry.path,
            type: getFileType(name),
            size: entry.size || 0,
            downloadUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${entry.path}`,
            isDirectory: false
          });
        }
      }

      return allFiles;
    } catch (error) {
      console.error(`Error fetching files from ${path}:`, error);
      return [];
    }
  };

  // Function to check if file is binary
  const isBinaryFile = (filename) => {
    const binaryExtensions = [
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.svg',
      '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
      '.zip', '.tar', '.gz', '.rar', '.7z', '.exe', '.dll', '.so',
      '.dylib', '.mp3', '.mp4', '.avi', '.mov', '.webm', '.ttf',
      '.woff', '.woff2', '.eot'
    ];
    return binaryExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  };

  // Function to load file content
  const loadFileContent = async (file) => {
    if (file.content) {
      setFileContent(file.content);
      return;
    }

    try {
      setError('');
      // Fetch file content via GitHub API to avoid raw.githubusercontent CORS and 403 issues
      if (!state.currentProject) throw new Error('No current project');
      const owner = state.currentProject.owner;
      const repo = state.currentProject.repo;
      const branch = state.currentProject.branch || state.currentProject.branch || 'main';

      const headers = {
        Accept: 'application/vnd.github.v3+json',
        ...(state.githubToken ? { Authorization: `token ${state.githubToken}` } : {})
      };

      const contentUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}?ref=${branch}`;
      const response = await axios.get(contentUrl, { headers });

      let content = '';
      if (response.data && response.data.content) {
        if (response.data.encoding === 'base64') {
          try {
            const decoded = atob(response.data.content);
            content = decodeURIComponent(Array.prototype.map.call(decoded, c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
          } catch (e) {
            content = atob(response.data.content);
          }
        } else {
          content = response.data.content;
        }
      } else if (file.downloadUrl) {
        // Fallback to download_url (may be blocked by CORS)
        const fallback = await axios.get(file.downloadUrl);
        content = fallback.data;
      }
      
      // Update file with content
      const updatedFile = { ...file, content };
      setSelectedFile(updatedFile);
      setFileContent(content);
      
      // Update files list
      setFiles(prevFiles => 
        prevFiles.map(f => f.path === file.path ? updatedFile : f)
      );
    } catch (error) {
      console.error('Error loading file content:', error);
      setError(`Failed to load file content: ${error.message}`);
    }
  };

  // Function to analyze code using Groq API with supported model
  const analyzeCode = async () => {
    if (!selectedFile || !fileContent) {
      setError('Please select a file to analyze');
      return;
    }

    setIsAnalyzing(true);
    setError('');
    setAnalysisResult(null);

    try {
      // Using llama3-8b-8192 instead of deprecated mixtral-8x7b-32768
      // Resolve backend URL: prefer Vite env, fallback to CRA env, then localhost
      const viteUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ANALYSIS_API_URL) ? import.meta.env.VITE_ANALYSIS_API_URL : null;
      const craUrl = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_ANALYSIS_API_URL) ? process.env.REACT_APP_ANALYSIS_API_URL : null;
      const backendBase = viteUrl || craUrl || 'http://localhost:8000';
      const backendBaseUrl = backendBase.replace(/\/$/, '');

      // Submit async job to backend
      const submitUrl = `${backendBaseUrl}/analyze_async`;
      const submitResp = await axios.post(
        submitUrl,
        { code: fileContent, fileName: selectedFile?.name || '', fileType: selectedFile?.type || '' },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const jobId = submitResp.data?.job_id;
      if (!jobId) throw new Error('No job id returned from analysis server');

      // Poll for job status
      const statusUrl = `${backendBaseUrl}/status/${jobId}`;
      let pollCount = 0;
      let jobData = null;
      while (pollCount < 120) { // timeout after ~120s
        await new Promise(res => setTimeout(res, 1000));
        pollCount++;
        try {
          const statusResp = await axios.get(statusUrl);
          jobData = statusResp.data;
          if (jobData.status === 'done' || jobData.status === 'failed') break;
        } catch (e) {
          // ignore transient errors while polling
        }
      }

      if (!jobData) throw new Error('Analysis job timed out');
      if (jobData.status === 'failed') throw new Error(jobData.error || 'Analysis failed');

      let analysisContent = jobData.result;
      
      try {
        // If backend returned structured JSON, use it; otherwise try to extract JSON from string
        if (typeof analysisContent === 'object') {
          setAnalysisResult(analysisContent);
        } else if (typeof analysisContent === 'string') {
          // Try extracting JSON from code fences first, then balanced-brace parsing
          const fromFences = extractJsonFromFences(analysisContent);
          if (fromFences) {
            setAnalysisResult(fromFences);
          } else {
            const fromBraces = extractJsonFromText(analysisContent);
            if (fromBraces) {
              setAnalysisResult(fromBraces);
            } else {
              throw new Error('No JSON found in response');
            }
          }
        } else {
          throw new Error('Unexpected analysis response format');
        }
      } catch (jsonError) {
        // If JSON parsing fails, create a structured response
        setAnalysisResult({
          errors: [],
          warnings: [],
          suggestions: [{
            line: 0,
            code: 'Analysis Result',
            message: analysisContent,
            severity: 'info'
          }],
          summary: { errorCount: 0, warningCount: 0, suggestionCount: 1 }
        });
      }
    } catch (error) {
      console.error('Error analyzing code:', error);
      const errorMessage = error.response?.data?.error?.message || 
                          error.response?.data?.message || 
                          error.message || 
                          'Failed to analyze code';
      setError(errorMessage);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Function to render the severity badge
  const SeverityBadge = ({ severity }) => {
    const colors = {
      high: 'bg-red-500/20 text-red-400',
      medium: 'bg-yellow-500/20 text-yellow-400',
      low: 'bg-blue-500/20 text-blue-400',
      info: 'bg-green-500/20 text-green-400'
    };

    return (
      <span className={`px-2 py-1 rounded text-xs ${colors[severity] || colors.info}`}>
        {severity}
      </span>
    );
  };

  // Function to handle file content changes
  const handleContentChange = (e) => {
    setFileContent(e.target.value);
  };

  // Function to save changes
  const handleSave = () => {
    if (selectedFile) {
      const updatedFile = { ...selectedFile, content: fileContent };
      setSelectedFile(updatedFile);
      setFiles(prevFiles => 
        prevFiles.map(f => f.path === selectedFile.path ? updatedFile : f)
      );
      setEditMode(false);
    }
  };

  // Function to handle file selection
  const handleFileSelect = async (file) => {
    setSelectedFilePath(file.path);
    setSelectedFile(file);
    setAnalysisResult(null);
    await loadFileContent(file);
  };

  // Load repository files when component mounts or project changes
  useEffect(() => {
    if (state.currentProject) {
      fetchRepositoryFiles();
    }
  }, [state.currentProject]);

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <h1 className="text-3xl font-bold text-white mb-4">Code Analyzer</h1>
        <p className="text-dark-300">
          Analyze your repository files for errors, bugs, and potential improvements using Groq AI
        </p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* File Explorer */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-dark-800 rounded-xl p-6 border border-dark-700"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold text-white flex items-center">
              <SafeIcon icon={FiFolder} className="w-5 h-5 mr-2 text-primary-400" />
              Repository Files ({files.length})
            </h3>
            <button
              onClick={fetchRepositoryFiles}
              disabled={isLoadingFiles}
              className="p-2 text-dark-300 hover:text-white"
            >
              <SafeIcon 
                icon={FiRefreshCw} 
                className={`w-4 h-4 ${isLoadingFiles ? 'animate-spin' : ''}`} 
              />
            </button>
          </div>

          {/* Repository Files List */}
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {isLoadingFiles ? (
              <div className="text-center py-8">
                <SafeIcon icon={FiRefreshCw} className="w-8 h-8 animate-spin mx-auto mb-2 text-primary-400" />
                <p className="text-dark-400">Loading repository files...</p>
              </div>
            ) : files.length > 0 ? (
              files.map((file, index) => {
                const IconComponent = getFileIcon(file.type);
                return (
                  <div
                    key={index}
                    className={`flex items-center space-x-2 p-2 rounded-lg cursor-pointer hover:bg-dark-700 transition-colors ${
                      selectedFilePath === file.path ? 'bg-dark-700 border-l-2 border-primary-500' : ''
                    }`}
                    onClick={() => handleFileSelect(file)}
                  >
                    <SafeIcon
                      icon={IconComponent}
                      className={`w-4 h-4 ${
                        file.type === 'folder' ? 'text-yellow-400' : 'text-blue-400'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-white text-sm truncate block">
                        {file.name}
                      </span>
                      <span className="text-dark-400 text-xs truncate block">
                        {file.path}
                      </span>
                    </div>
                    {file.size && (
                      <span className="text-dark-400 text-xs">
                        {(file.size / 1024).toFixed(1)}KB
                      </span>
                    )}
                  </div>
                );
              })
            ) : state.currentProject ? (
              <div className="text-center py-8">
                <SafeIcon icon={FiGitBranch} className="w-8 h-8 mx-auto mb-2 text-dark-500" />
                <p className="text-dark-400">No files found in repository</p>
              </div>
            ) : (
              <div className="text-center py-8">
                <SafeIcon icon={FiGitBranch} className="w-8 h-8 mx-auto mb-2 text-dark-500" />
                <p className="text-dark-400">Analyze a project first to view files</p>
              </div>
            )}
          </div>
        </motion.div>

        {/* Code Editor and Analysis */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className="lg:col-span-2 bg-dark-800 rounded-xl p-6 border border-dark-700"
        >
          {selectedFile ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <SafeIcon
                    icon={getFileIcon(selectedFile.type)}
                    className="w-5 h-5 text-primary-400"
                  />
                  <div>
                    <h3 className="text-xl font-semibold text-white">
                      {selectedFile.name}
                    </h3>
                    <p className="text-sm text-dark-400">{selectedFile.path}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {editMode ? (
                    <button
                      onClick={handleSave}
                      className="p-2 text-green-400 hover:text-green-300"
                    >
                      <SafeIcon icon={FiSave} className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => setEditMode(true)}
                      className="p-2 text-dark-300 hover:text-white"
                    >
                      <SafeIcon icon={FiEdit} className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="mb-6">
                <textarea
                  value={fileContent}
                  onChange={handleContentChange}
                  disabled={!editMode}
                  className="w-full h-64 px-4 py-3 bg-dark-900 text-white rounded-lg border border-dark-600 font-mono text-sm resize-none focus:outline-none focus:border-primary-500 disabled:opacity-60"
                  placeholder="File content will appear here..."
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-4">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter your Groq API Key"
                    className="flex-grow px-4 py-2 bg-dark-700 text-white rounded-lg border border-dark-600 focus:border-primary-500 focus:outline-none"
                  />
                  <button
                    onClick={analyzeCode}
                    disabled={isAnalyzing || !apiKey || !fileContent}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    {isAnalyzing ? (
                      <>
                        <SafeIcon icon={FiSearch} className="w-4 h-4 animate-spin" />
                        <span>Analyzing...</span>
                      </>
                    ) : (
                      <>
                        <SafeIcon icon={FiSearch} className="w-4 h-4" />
                        <span>Analyze Code</span>
                      </>
                    )}
                  </button>
                </div>

                {error && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <p className="text-red-400 flex items-center">
                      <SafeIcon icon={FiAlertTriangle} className="w-4 h-4 mr-2" />
                      {error}
                    </p>
                  </div>
                )}

                {analysisResult && (
                  <div className="space-y-6">
                    {/* Analysis Summary */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-dark-700 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-red-400">Errors</span>
                          <span className="text-2xl font-bold text-white">
                            {analysisResult.summary?.errorCount || analysisResult.errors?.length || 0}
                          </span>
                        </div>
                      </div>
                      <div className="bg-dark-700 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-yellow-400">Warnings</span>
                          <span className="text-2xl font-bold text-white">
                            {analysisResult.summary?.warningCount || analysisResult.warnings?.length || 0}
                          </span>
                        </div>
                      </div>
                      <div className="bg-dark-700 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-blue-400">Suggestions</span>
                          <span className="text-2xl font-bold text-white">
                            {analysisResult.summary?.suggestionCount || analysisResult.suggestions?.length || 0}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Detailed Analysis */}
                    {analysisResult.errors && analysisResult.errors.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-lg font-medium text-white">Errors</h4>
                        {analysisResult.errors.map((error, index) => (
                          <div key={index} className="p-3 bg-dark-700 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-red-400">Line {error.line}</span>
                              <SeverityBadge severity={error.severity} />
                            </div>
                            <p className="text-white text-sm mb-2">{error.message}</p>
                            <pre className="bg-dark-900 p-2 rounded text-xs text-dark-300">
                              {error.code}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}

                    {analysisResult.warnings && analysisResult.warnings.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-lg font-medium text-white">Warnings</h4>
                        {analysisResult.warnings.map((warning, index) => (
                          <div key={index} className="p-3 bg-dark-700 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-yellow-400">Line {warning.line}</span>
                              <SeverityBadge severity={warning.severity} />
                            </div>
                            <p className="text-white text-sm mb-2">{warning.message}</p>
                            <pre className="bg-dark-900 p-2 rounded text-xs text-dark-300">
                              {warning.code}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}

                    {analysisResult.suggestions && analysisResult.suggestions.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-lg font-medium text-white">Suggestions</h4>
                        {analysisResult.suggestions.map((suggestion, index) => (
                          <div key={index} className="p-3 bg-dark-700 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-blue-400">
                                {suggestion.line > 0 ? `Line ${suggestion.line}` : 'General'}
                              </span>
                              <SeverityBadge severity={suggestion.severity} />
                            </div>
                            <p className="text-white text-sm mb-2">{suggestion.message}</p>
                            {suggestion.code && suggestion.code !== 'N/A' && (
                              <pre className="bg-dark-900 p-2 rounded text-xs text-dark-300">
                                {suggestion.code}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
              <SafeIcon icon={FiCode} className="w-16 h-16 text-dark-500 mb-4" />
              <h2 className="text-2xl font-bold text-white mb-2">No File Selected</h2>
              <p className="text-dark-400 mb-6">
                Select a file from the repository to analyze its code
              </p>
              {!state.currentProject && (
                <button
                  onClick={() => window.location.hash = '/analyze'}
                  className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-all duration-200"
                >
                  Analyze a Project First
                </button>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default CodeAnalyzer;