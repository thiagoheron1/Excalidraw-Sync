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
    return { syncAuthority: providers.syncAuthority || "local", github, googleDrive };
  }

  function providerSessionState(providers = {}) {
    return {
      github: {
        pendingAuth: providers.github?.pendingAuth || null,
      },
      googleDrive: {},
    };
  }

  function providerCredentialState(providers = {}) {
    return {
      github: {
        auth: providers.github?.auth || null,
        account: providers.github?.account || null,
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

  function mergeProviderStorage(defaults, persistent = {}, session = {}, credentials = {}) {
    return {
      syncAuthority: ["local", "github", "googleDrive"].includes(persistent.syncAuthority)
        ? persistent.syncAuthority
        : defaults.syncAuthority || "local",
      github: {
        ...defaults.github,
        ...persistent.github,
        ...credentials.github,
        pendingAuth: session.github?.pendingAuth || null,
        config: { ...defaults.github.config, ...persistent.github?.config },
      },
      googleDrive: {
        ...defaults.googleDrive,
        ...persistent.googleDrive,
        ...credentials.googleDrive,
        config: { ...defaults.googleDrive.config, ...persistent.googleDrive?.config },
      },
    };
  }

  const api = {
    hasSensitiveProviderData,
    mergeProviderStorage,
    providerCredentialState,
    providerPersistentState,
    providerSessionState,
  };
  globalScope.ExcalidrawSyncSecurity = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
