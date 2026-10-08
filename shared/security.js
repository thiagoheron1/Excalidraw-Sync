(function initializeSecurity(globalScope) {
  "use strict";

  function providerPersistentState(providers = {}) {
    const {
      auth: _githubAuth,
      account: _githubAccount,
      pendingAuth: _githubPendingAuth,
      ...github
    } = providers.github || {};
    return { syncAuthority: providers.syncAuthority === "github" ? "github" : "local", github };
  }

  function providerSessionState(providers = {}) {
    return {
      github: {
        pendingAuth: providers.github?.pendingAuth || null,
      },
    };
  }

  function providerCredentialState(providers = {}) {
    return {
      github: {
        auth: providers.github?.auth || null,
        account: providers.github?.account || null,
      },
    };
  }

  function hasSensitiveProviderData(providers = {}) {
    return Boolean(
      providers.github?.auth || providers.github?.pendingAuth,
    );
  }

  function mergeProviderStorage(defaults, persistent = {}, session = {}, credentials = {}) {
    return {
      syncAuthority: ["local", "github"].includes(persistent.syncAuthority)
        ? persistent.syncAuthority
        : defaults.syncAuthority || "local",
      github: {
        ...defaults.github,
        ...persistent.github,
        ...credentials.github,
        pendingAuth: session.github?.pendingAuth || null,
        config: { ...defaults.github.config, ...persistent.github?.config },
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
