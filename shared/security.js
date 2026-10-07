(function initializeSecurity(globalScope) {
  "use strict";

  function providerPersistentState(providers = {}) {
    const {
      auth: _githubAuth,
      account: _githubAccount,
      pendingAuth: _githubPendingAuth,
      ...github
    } = providers.github || {};
    const {
      auth: _googleAuth,
      account: _googleAccount,
      pendingAuth: _googlePendingAuth,
      ...googleDrive
    } = providers.googleDrive || {};
    return { github, googleDrive };
  }

  function providerSessionState(providers = {}) {
    return {
      github: {
        auth: providers.github?.auth || null,
        account: providers.github?.account || null,
        pendingAuth: providers.github?.pendingAuth || null,
      },
      googleDrive: {
        auth: providers.googleDrive?.auth || null,
        account: providers.googleDrive?.account || null,
      },
    };
  }

  function hasSensitiveProviderData(providers = {}) {
    return Boolean(
      providers.github?.auth
      || providers.github?.pendingAuth
      || providers.googleDrive?.auth,
    );
  }

  function mergeProviderStorage(defaults, persistent = {}, session = {}) {
    return {
      github: {
        ...defaults.github,
        ...persistent.github,
        ...session.github,
        config: { ...defaults.github.config, ...persistent.github?.config },
      },
      googleDrive: {
        ...defaults.googleDrive,
        ...persistent.googleDrive,
        ...session.googleDrive,
        config: { ...defaults.googleDrive.config, ...persistent.googleDrive?.config },
      },
    };
  }

  const api = {
    hasSensitiveProviderData,
    mergeProviderStorage,
    providerPersistentState,
    providerSessionState,
  };
  globalScope.ExcalidrawSyncSecurity = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
