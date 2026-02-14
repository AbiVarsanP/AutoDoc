import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useProject } from '../context/ProjectContext';
import SafeIcon from '../common/SafeIcon';
import * as FiIcons from 'react-icons/fi';
import axios from 'axios';
import { formatGithubError } from '../utils/githubHelpers';

const { FiGitBranch, FiDownload, FiSearch, FiPackage, FiCode, FiDatabase, FiTool, FiKey, FiCheck, FiAlertCircle } = FiIcons;

const ProjectAnalyzer = () => {
  const { state, dispatch } = useProject();
  const [localRepoUrl, setLocalRepoUrl] = useState(state.repoUrl);
  const [isCloning, setIsCloning] = useState(false);
  const [localToken, setLocalToken] = useState(state.githubToken || '');
  const [tokenError, setTokenError] = useState('');
  const [userInfo, setUserInfo] = useState(null);

  const handleTokenSave = async () => {
    if (!localToken) {
      setTokenError('Please enter a GitHub token');
      return;
    }

    try {
      const response = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `token ${localToken}`,
        },
      });

      setUserInfo(response.data);
      dispatch({ type: 'SET_GITHUB_TOKEN', payload: localToken });
      setTokenError('');
    } catch (error) {
      const friendly = formatGithubError(error, 'Invalid token');
      setTokenError(friendly);
      setUserInfo(null);
    }
  };

  const analyzeRepository = async () => {
    if (!localRepoUrl || !localRepoUrl.includes('github.com')) {
      dispatch({ 
        type: 'SET_ERROR', 
        payload: 'Please enter a valid GitHub repository URL' 
      });
      return;
    }

    dispatch({ type: 'SET_ANALYZING', payload: true });
    dispatch({ type: 'SET_REPO_URL', payload: localRepoUrl });
    dispatch({ type: 'CLEAR_LOGS' });
    setIsCloning(true);

    try {
      // Extract owner and repo from the URL
      const url = new URL(localRepoUrl);
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 2) {
        throw new Error('Invalid repository URL format');
      }
      
      const owner = parts[0];
      const repo = parts[1].replace('.git', '');
      
      // Prepare headers (use token if available)
      const headers = {
        Accept: 'application/vnd.github.v3+json',
        ...(state.githubToken ? { Authorization: `token ${state.githubToken}` } : {})
      };

      // Step 1: Get repository info
      dispatch({ type: 'ADD_LOG', payload: { type: 'info', message: 'Fetching repository information...' } });

      const repoResponse = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, { headers });

      const repoInfo = repoResponse.data;
      
      // Step 2: Get repository contents
      dispatch({ type: 'ADD_LOG', payload: { type: 'info', message: 'Analyzing repository structure...' } });
      
      const contentsResponse = await axios.get(`https://api.github.com/repos/${owner}/${repo}/contents`, { headers });
      const contents = contentsResponse.data;
      
      // Step 3: Find package.json, requirements.txt, etc. to identify dependencies
      const packageJsonFile = contents.find(file => file.name === 'package.json');
      const requirementsFile = contents.find(file => file.name === 'requirements.txt');
      const composerJsonFile = contents.find(file => file.name === 'composer.json');
      
      let dependencies = [];
      let techStack = {
        language: repoInfo.language || 'Unknown',
        frameworks: [],
        databases: [],
        tools: [],
        deployment: []
      };
      
      // Helper to fetch file contents via GitHub API (returns decoded text)
      const fetchContentViaApi = async (filePath) => {
        try {
          const contentUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${repoInfo.default_branch}`;
          const resp = await axios.get(contentUrl, { headers });
          if (resp.data && resp.data.content) {
            if (resp.data.encoding === 'base64') {
              try {
                const decoded = atob(resp.data.content);
                return decodeURIComponent(Array.prototype.map.call(decoded, c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
              } catch (e) {
                return atob(resp.data.content);
              }
            }
            return resp.data.content;
          }
          return '';
        } catch (err) {
          console.error('Error fetching file via API:', err);
          // Fallback to download_url which may be blocked by CORS
          try {
            const fallback = await axios.get(`https://raw.githubusercontent.com/${owner}/${repo}/${repoInfo.default_branch}/${filePath}`);
            return fallback.data;
          } catch (fb) {
            console.error('Fallback raw fetch failed:', fb);
            return '';
          }
        }
      };

      // Process package.json for Node.js projects
      if (packageJsonFile) {
        const packageJsonText = await fetchContentViaApi(packageJsonFile.path);
        let packageJson = {};
        try {
          packageJson = typeof packageJsonText === 'string' ? JSON.parse(packageJsonText) : packageJsonText;
        } catch (e) {
          console.error('Failed to parse package.json:', e);
          packageJson = {};
        }
        
        // Extract dependencies
        const prodDeps = packageJson.dependencies || {};
        const devDeps = packageJson.devDependencies || {};
        
        for (const [name, version] of Object.entries(prodDeps)) {
          dependencies.push({ name, version, type: 'production' });
          
          // Detect frameworks
          if (['react', 'vue', 'angular', 'next', 'nuxt', 'svelte'].includes(name)) {
            techStack.frameworks.push(name);
          }
          
          // Detect databases
          if (['pg', 'mongodb', 'mongoose', 'sequelize', 'mysql', 'sqlite3', 'redis'].includes(name)) {
            techStack.databases.push(name);
          }
        }
        
        for (const [name, version] of Object.entries(devDeps)) {
          dependencies.push({ name, version, type: 'development' });
          
          // Detect build tools
          if (['webpack', 'rollup', 'parcel', 'vite', 'esbuild'].includes(name)) {
            techStack.tools.push(name);
          }
        }
        
        // Check for Docker-related files
        const dockerfileExists = contents.find(file => file.name === 'Dockerfile');
        const dockerComposeExists = contents.find(file => file.name === 'docker-compose.yml');
        
        if (dockerfileExists || dockerComposeExists) {
          techStack.deployment.push('Docker');
        }
      }
      
      // Process requirements.txt for Python projects
      if (requirementsFile) {
        const requirementsText = await fetchContentViaApi(requirementsFile.path);
        const requirements = (requirementsText || '').split('\n').filter(Boolean);
        
        for (const requirement of requirements) {
          const [name, version] = requirement.split('==');
          dependencies.push({ name, version: version || 'latest', type: 'production' });
          
          // Detect frameworks
          if (['django', 'flask', 'fastapi', 'tornado', 'pyramid'].includes(name.toLowerCase())) {
            techStack.frameworks.push(name);
          }
          
          // Detect databases
          if (['psycopg2', 'pymongo', 'sqlalchemy', 'pymysql', 'redis'].includes(name.toLowerCase())) {
            techStack.databases.push(name);
          }
        }
      }
      
      // Create project metadata
      const mockProject = {
        name: repoInfo.name,
        description: repoInfo.description || 'No description available',
        language: repoInfo.language,
        size: `${(repoInfo.size / 1024).toFixed(2)} MB`,
        files: contents.length,
        lastCommit: new Date(repoInfo.updated_at).toLocaleString(),
        owner: owner,
        repo: repo,
        branch: repoInfo.default_branch,
        url: repoInfo.html_url
      };
      
      dispatch({ type: 'SET_CURRENT_PROJECT', payload: mockProject });
      dispatch({ type: 'SET_TECH_STACK', payload: techStack });
      dispatch({ type: 'SET_DEPENDENCIES', payload: dependencies });
      dispatch({ type: 'ADD_LOG', payload: { type: 'success', message: 'Repository analysis completed successfully!' } });
      
    } catch (error) {
      console.error('Analysis error:', error);
      const friendly = formatGithubError(error, 'Repository analysis failed');
      dispatch({ 
        type: 'SET_ERROR', 
        payload: friendly
      });
      dispatch({ 
        type: 'ADD_LOG', 
        payload: { 
          type: 'error', 
          message: friendly
        }
      });
    } finally {
      dispatch({ type: 'SET_ANALYZING', payload: false });
      setIsCloning(false);
    }
  };

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <h1 className="text-3xl font-bold text-white mb-4">Project Analyzer</h1>
        <p className="text-dark-300">Clone and analyze any repository to detect tech stack and dependencies</p>
      </motion.div>

      {/* GitHub Token Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-dark-800 rounded-xl p-6 border border-dark-700"
      >
        <h3 className="text-xl font-semibold text-white mb-4 flex items-center">
          <SafeIcon icon={FiKey} className="w-5 h-5 mr-2 text-primary-400" />
          GitHub Token (Optional)
        </h3>
        
        {!userInfo ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-dark-400 mb-2">
                Personal Access Token (Increases API rate limits)
              </label>
              <input
                type="password"
                value={localToken}
                onChange={(e) => setLocalToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full px-4 py-3 bg-dark-700 text-white rounded-lg border border-dark-600 focus:border-primary-500 focus:outline-none"
              />
              {tokenError && (
                <p className="text-red-400 text-sm mt-2 flex items-center">
                  <SafeIcon icon={FiAlertCircle} className="w-4 h-4 mr-1" />
                  {tokenError}
                </p>
              )}
            </div>
            
            <div className="bg-dark-700 rounded-lg p-4">
              <h4 className="text-white font-medium mb-2">How to get a GitHub Token:</h4>
              <ol className="text-dark-300 text-sm space-y-2 list-decimal list-inside">
                <li>Go to <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:underline">GitHub Settings → Personal access tokens</a></li>
                <li>Click <strong className="text-white">"Generate new token (classic)"</strong></li>
                <li>
                  Select scope: <code className="bg-dark-600 px-1 rounded">public_repo</code> (for public repos) or <code className="bg-dark-600 px-1 rounded">repo</code> (for private repos)
                </li>
                <li>Set expiration and click "Generate token"</li>
                <li>Copy the token immediately</li>
              </ol>
              <p className="text-xs text-dark-400 mt-2">Note: Token is optional but prevents rate limit errors</p>
            </div>
            
            <button
              onClick={handleTokenSave}
              disabled={!localToken}
              className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              Validate Token
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
            <div className="flex items-center space-x-3">
              <SafeIcon icon={FiCheck} className="w-5 h-5 text-green-400" />
              <div>
                <p className="text-white font-medium">Connected as {userInfo.login}</p>
                <p className="text-dark-300 text-sm">{userInfo.name || 'No name set'}</p>
              </div>
            </div>
            <button
              onClick={() => {
                setUserInfo(null);
                setLocalToken('');
                dispatch({ type: 'SET_GITHUB_TOKEN', payload: '' });
              }}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all duration-200"
            >
              Disconnect
            </button>
          </div>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-dark-800 rounded-xl p-6 border border-dark-700"
      >
        <h3 className="text-xl font-semibold text-white mb-4 flex items-center">
          <SafeIcon icon={FiGitBranch} className="w-5 h-5 mr-2 text-primary-400" />
          Repository URL
        </h3>
        
        <div className="flex space-x-4">
          <input
            type="url"
            value={localRepoUrl}
            onChange={(e) => setLocalRepoUrl(e.target.value)}
            placeholder="https://github.com/username/repository"
            className="flex-1 px-4 py-3 bg-dark-700 text-white rounded-lg border border-dark-600 focus:border-primary-500 focus:outline-none"
          />
          <button
            onClick={analyzeRepository}
            disabled={state.isAnalyzing || !localRepoUrl}
            className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 transition-all duration-200"
          >
            {state.isAnalyzing ? (
              <>
                <SafeIcon icon={FiDownload} className="w-4 h-4 animate-spin" />
                <span>Analyzing...</span>
              </>
            ) : (
              <>
                <SafeIcon icon={FiSearch} className="w-4 h-4" />
                <span>Analyze</span>
              </>
            )}
          </button>
        </div>
      </motion.div>

      {state.logs.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-dark-800 rounded-xl p-6 border border-dark-700"
        >
          <h3 className="text-xl font-semibold text-white mb-4">Analysis Logs</h3>
          <div className="bg-dark-900 rounded-lg p-4 font-mono text-sm max-h-64 overflow-y-auto">
            {state.logs.map((log, index) => (
              <div key={index} className={`mb-2 ${
                log.type === 'error' ? 'text-red-400' : 
                log.type === 'success' ? 'text-green-400' : 
                'text-dark-300'
              }`}>
                <span className="text-dark-500">[{new Date().toLocaleTimeString()}]</span> {log.message}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {state.currentProject && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-dark-800 rounded-xl p-6 border border-dark-700"
          >
            <h3 className="text-xl font-semibold text-white mb-4 flex items-center">
              <SafeIcon icon={FiCode} className="w-5 h-5 mr-2 text-primary-400" />
              Project Details
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-dark-400">Name:</span>
                <span className="text-white">{state.currentProject.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-400">Language:</span>
                <span className="text-white">{state.currentProject.language}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-400">Size:</span>
                <span className="text-white">{state.currentProject.size}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-400">Files:</span>
                <span className="text-white">{state.currentProject.files}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-400">Last Update:</span>
                <span className="text-white">{state.currentProject.lastCommit}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-400">Repository:</span>
                <a 
                  href={state.currentProject.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary-400 hover:text-primary-300 truncate max-w-[200px]"
                >
                  {state.currentProject.url}
                </a>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-dark-800 rounded-xl p-6 border border-dark-700"
          >
            <h3 className="text-xl font-semibold text-white mb-4 flex items-center">
              <SafeIcon icon={FiTool} className="w-5 h-5 mr-2 text-primary-400" />
              Tech Stack
            </h3>
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-dark-400 mb-2">Frameworks</h4>
                <div className="flex flex-wrap gap-2">
                  {state.techStack?.frameworks?.length > 0 ? (
                    state.techStack.frameworks.map((framework, index) => (
                      <span key={index} className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">
                        {framework}
                      </span>
                    ))
                  ) : (
                    <span className="text-dark-400 text-xs">None detected</span>
                  )}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-dark-400 mb-2">Databases</h4>
                <div className="flex flex-wrap gap-2">
                  {state.techStack?.databases?.length > 0 ? (
                    state.techStack.databases.map((db, index) => (
                      <span key={index} className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs">
                        {db}
                      </span>
                    ))
                  ) : (
                    <span className="text-dark-400 text-xs">None detected</span>
                  )}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-dark-400 mb-2">Tools</h4>
                <div className="flex flex-wrap gap-2">
                  {state.techStack?.tools?.length > 0 ? (
                    state.techStack.tools.map((tool, index) => (
                      <span key={index} className="px-2 py-1 bg-purple-500/20 text-purple-400 rounded text-xs">
                        {tool}
                      </span>
                    ))
                  ) : (
                    <span className="text-dark-400 text-xs">None detected</span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {state.dependencies.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-dark-800 rounded-xl p-6 border border-dark-700"
        >
          <h3 className="text-xl font-semibold text-white mb-4 flex items-center">
            <SafeIcon icon={FiPackage} className="w-5 h-5 mr-2 text-primary-400" />
            Dependencies ({state.dependencies.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {state.dependencies.map((dep, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-dark-700 rounded-lg">
                <div>
                  <span className="text-white font-medium">{dep.name}</span>
                  <span className="text-dark-400 text-sm ml-2">{dep.version}</span>
                </div>
                <span className={`px-2 py-1 rounded text-xs ${
                  dep.type === 'production' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {dep.type}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default ProjectAnalyzer;