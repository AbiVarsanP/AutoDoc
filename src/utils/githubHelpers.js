// Shared GitHub helpers
export const formatGithubError = (error, defaultMessage) => {
  const apiMsg = error?.response?.data?.message;
  const status = error?.response?.status;
  const headers = error?.response?.headers || {};

  // Check for insufficient token permissions
  if (apiMsg && apiMsg.toLowerCase().includes('resource not accessible by personal access token')) {
    return 'GitHub token missing required permissions. Go to GitHub Settings → Personal Access Tokens → Edit your token → Check the "repo" scope (Full control of private repositories). Then regenerate and update your token here.';
  }

  // Check for authentication issues
  if (status === 401 || apiMsg?.toLowerCase().includes('bad credentials')) {
    return 'Invalid GitHub token. Please check your token and try again.';
  }

  // Check for rate limiting
  if (status === 403 && (apiMsg?.toLowerCase().includes('rate limit') || headers['x-ratelimit-remaining'] === '0')) {
    const reset = headers['x-ratelimit-reset'];
    let resetTime = '';
    if (reset) {
      const seconds = parseInt(reset, 10);
      if (!isNaN(seconds)) {
        resetTime = ` Rate limit resets at ${new Date(seconds * 1000).toLocaleTimeString()}.`;
      }
    }

    return `GitHub API rate limit reached. Provide a GitHub token or try again later.${resetTime}`;
  }

  // Check for permission denied
  if (status === 403 && !apiMsg?.toLowerCase().includes('rate limit')) {
    return 'Access denied. Your token may not have the required permissions (needs "repo" scope for private repos or "public_repo" for public repos).';
  }

  return apiMsg || defaultMessage || (error?.message || 'An error occurred');
};

export default formatGithubError;
