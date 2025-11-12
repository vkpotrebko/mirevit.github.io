module.exports = function override(config, env) {
  // Webpack 5 polyfill configuration for Node.js modules
  config.resolve.fallback = {
    ...config.resolve.fallback,
    "fs": false,
    "path": false,
    "url": false,
  };
  
  return config;
};
