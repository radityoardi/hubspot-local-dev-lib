import { debug, makeTypedLogger } from '../utils/logger';
import { throwErrorWithMessage } from '../errors/standardErrors';
import { getValidEnv, loadConfigFromEnvironment } from './environment';
import {
  loadConfigFromFile,
  writeConfigToFile,
  configFileExists,
  configFileIsBlank,
  deleteConfigFile,
} from './configFile';
import { commaSeparatedValues } from '../utils/text';
import { ENVIRONMENTS } from '../constants';
import { API_KEY_AUTH_METHOD } from '../constants/auth';
import { DEFAULT_MODES, MIN_HTTP_TIMEOUT } from '../constants/config';
import { CLIConfig } from '../types/Config';
import {
  CLIAccount,
  OAuthAccount,
  FlatAccountFields,
  OauthTokenInfo,
  PersonalAccessKeyTokenInfo,
} from '../types/Accounts';
import { CLIOptions } from '../types/CLIOptions';
import { ValueOf } from '../types/Utils';
import { LogCallbacksArg } from '../types/LogCallbacks';

const i18nKey = 'config.cliConfiguration';

const validateLogCallbackKeys = [
  'noConfig',
  'noConfigAccounts',
  'emptyAccountConfig',
  'noAccountId',
  'duplicateAccountIds',
  'duplicateAccountNames',
  'nameContainsSpaces',
] as const;

class CLIConfiguration {
  options: CLIOptions;
  useEnvConfig: boolean;
  config: CLIConfig | null;

  constructor() {
    this.options = {};
    this.useEnvConfig = false;
    this.config = null;
  }

  init(options: CLIOptions = {}): void {
    this.options = options;
    this.load();
  }

  load(): CLIConfig | null {
    if (this.options.useEnv) {
      const configFromEnv = loadConfigFromEnvironment();
      if (configFromEnv) {
        debug(`${i18nKey}.load.configFromEnv`, {
          accountId: configFromEnv.accounts[0].accountId,
        });
        this.useEnvConfig = true;
        this.config = configFromEnv;
      }
    } else {
      const configFromFile = loadConfigFromFile();
      debug(`${i18nKey}.load.configFromFile`);

      if (!configFromFile) {
        debug(`${i18nKey}.load.empty`);
        this.config = { accounts: [] };
      }
      this.useEnvConfig = false;
      this.config = configFromFile;
    }

    return this.config;
  }

  configIsEmpty(): boolean {
    if (!configFileExists() || configFileIsBlank()) {
      return true;
    } else {
      this.load();
      if (
        !!this.config &&
        Object.keys(this.config).length === 1 &&
        !!this.config.accounts
      ) {
        return true;
      }
    }
    return false;
  }

  delete(): void {
    if (!this.useEnvConfig && this.configIsEmpty()) {
      deleteConfigFile();
      this.config = null;
    }
  }

  write(updatedConfig?: CLIConfig): CLIConfig | null {
    if (!this.useEnvConfig) {
      if (updatedConfig) {
        this.config = updatedConfig;
      }
      if (this.config) {
        writeConfigToFile(this.config);
      }
    }
    return this.config;
  }

  validate(
    logCallbacks?: LogCallbacksArg<typeof validateLogCallbackKeys>
  ): boolean {
    const validateLogger = makeTypedLogger<typeof validateLogCallbackKeys>(
      logCallbacks,
      'config.cliConfiguration.validate'
    );

    if (!this.config) {
      validateLogger('noConfig');
      return false;
    }
    if (!Array.isArray(this.config.accounts)) {
      validateLogger('noConfigAccounts');
      return false;
    }

    const accountIdsMap: { [key: number]: boolean } = {};
    const accountNamesMap: { [key: string]: boolean } = {};

    return this.config.accounts.every(accountConfig => {
      if (!accountConfig) {
        validateLogger('emptyAccountConfig');
        return false;
      }
      if (!accountConfig.accountId) {
        validateLogger('noAccountId');
        return false;
      }
      if (accountIdsMap[accountConfig.accountId]) {
        validateLogger('duplicateAccountIds', {
          accountId: accountConfig.accountId,
        });
        return false;
      }
      if (accountConfig.name) {
        if (accountNamesMap[accountConfig.name]) {
          validateLogger('duplicateAccountNames', {
            accountName: accountConfig.name,
          });
          return false;
        }
        if (/\s+/.test(accountConfig.name)) {
          validateLogger('nameContainsSpaces', {
            accountName: accountConfig.name,
          });
          return false;
        }
        accountNamesMap[accountConfig.name] = true;
      }

      accountIdsMap[accountConfig.accountId] = true;
      return true;
    });
  }

  getAccount(nameOrId: string | number | undefined): CLIAccount | null {
    let name: string | null = null;
    let accountId: number | null = null;

    if (!this.config) {
      return null;
    }

    const nameOrIdToCheck = nameOrId ? nameOrId : this.getDefaultAccount();

    if (!nameOrIdToCheck) {
      return null;
    }

    if (typeof nameOrIdToCheck === 'number') {
      accountId = nameOrIdToCheck;
    } else if (/^\d+$/.test(nameOrIdToCheck)) {
      accountId = parseInt(nameOrIdToCheck, 10);
    } else {
      name = nameOrIdToCheck;
    }

    if (name) {
      return this.config.accounts.find(a => a.name === name) || null;
    } else if (accountId) {
      return this.config.accounts.find(a => accountId === a.accountId) || null;
    }

    return null;
  }

  getAccountId(nameOrId: string | number): number | null {
    const account = this.getAccount(nameOrId);
    return account ? account.accountId : null;
  }

  getDefaultAccount(): string | number | null {
    return this.config && this.config.defaultAccount
      ? this.config.defaultAccount
      : null;
  }

  // TODO a util that returns the account to use, respecting the values set in
  // "defaultAccountOverrides"
  // Example "defaultAccountOverrides":
  //  - /src/brodgers/customer-project-1: customer-account1
  //  - /src/brodgers/customer-project-2: customer-account2
  // "/src/brodgers/customer-project-1" is the path to the project dir
  // "customer-account1" is the name of the account to use as the default for the specified dir
  // These defaults take precedence over the standard default account specified in the config
  getResolvedDefaultAccountForCWD(
    nameOrId: string | number
  ): CLIAccount | null {
    return this.getAccount(nameOrId);
  }

  getConfigAccountIndex(accountId: number): number {
    return this.config
      ? this.config.accounts.findIndex(
          account => account.accountId === accountId
        )
      : -1;
  }

  isAccountInConfig(nameOrId: string | number): boolean {
    return (
      !!this.config && this.config.accounts && !!this.getAccountId(nameOrId)
    );
  }

  getAndLoadConfigIfNeeded(options?: CLIOptions): CLIConfig {
    if (!this.config) {
      this.init(options);
    }
    return this.config!;
  }

  getEnv(nameOrId?: string | number): string {
    const accountConfig = this.getAccount(nameOrId);

    if (accountConfig && accountConfig.accountId && accountConfig.env) {
      return accountConfig.env;
    }
    if (this.config && this.config.env) {
      return this.config.env;
    }
    return ENVIRONMENTS.PROD;
  }

  /*
   * Config Update Utils
   */

  /**
   * @throws {Error}
   */
  updateAccount(
    updatedAccountFields: FlatAccountFields<OauthTokenInfo>,
    writeUpdate = true
  ): CLIAccount | null {
    const {
      accountId,
      apiKey,
      authType,
      clientId,
      clientSecret,
      defaultMode,
      env,
      name,
      parentAccountId,
      personalAccessKey,
      sandboxAccountType,
      scopes,
      tokenInfo,
    } = updatedAccountFields;

    if (!accountId) {
      throwErrorWithMessage(`${i18nKey}.updateAccount`);
    }
    if (!this.config) {
      debug(`${i18nKey}.updateAccount.noConfigToUpdate`);
      return null;
    }

    const currentAccountConfig = this.getAccount(accountId);

    let auth: OAuthAccount['auth'];
    if (clientId || clientSecret || scopes || tokenInfo) {
      auth = {
        ...(currentAccountConfig ? currentAccountConfig.auth : {}),
        clientId,
        clientSecret,
        scopes,
        tokenInfo,
      };
    }

    const nextAccountConfig: Partial<FlatAccountFields<OauthTokenInfo>> = {
      ...(currentAccountConfig ? currentAccountConfig : {}),
    };

    // Allow everything except for 'undefined' values to override the existing values
    function safelyApplyUpdates<
      T extends keyof FlatAccountFields<
        OauthTokenInfo | PersonalAccessKeyTokenInfo
      >
    >(
      fieldName: T,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newValue: FlatAccountFields<OauthTokenInfo>[T]
    ) {
      if (typeof newValue !== 'undefined') {
        nextAccountConfig[fieldName] = newValue;
      }
    }

    const updatedEnv = getValidEnv(
      env || (currentAccountConfig && currentAccountConfig.env),
      false
    );
    const updatedDefaultMode: ValueOf<typeof DEFAULT_MODES> | undefined =
      defaultMode &&
      (defaultMode.toLowerCase() as ValueOf<typeof DEFAULT_MODES>);

    safelyApplyUpdates('name', name);
    safelyApplyUpdates('env', updatedEnv);
    safelyApplyUpdates('accountId', accountId);
    safelyApplyUpdates('authType', authType);
    safelyApplyUpdates('auth', auth);
    if (nextAccountConfig.authType === API_KEY_AUTH_METHOD.value) {
      safelyApplyUpdates('apiKey', apiKey);
    }
    if (typeof updatedDefaultMode !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      safelyApplyUpdates('defaultMode', DEFAULT_MODES[updatedDefaultMode]);
    }
    safelyApplyUpdates('personalAccessKey', personalAccessKey);
    safelyApplyUpdates('sandboxAccountType', sandboxAccountType);
    safelyApplyUpdates('parentAccountId', parentAccountId);

    const completedAccountConfig = nextAccountConfig as FlatAccountFields<
      OauthTokenInfo | PersonalAccessKeyTokenInfo
    >;

    if (currentAccountConfig) {
      debug(`${i18nKey}.updateAccount.updating`, {
        accountId,
      });
      const index = this.getConfigAccountIndex(accountId);
      this.config.accounts[index] = completedAccountConfig;
      debug(`${i18nKey}.updateAccount.addingConfigEntry`, {
        accountId,
      });
      if (this.config.accounts) {
        this.config.accounts.push(completedAccountConfig);
      } else {
        this.config.accounts = [completedAccountConfig];
      }
    }

    if (writeUpdate) {
      this.write();
    }

    return completedAccountConfig;
  }

  /**
   * @throws {Error}
   */
  updateDefaultAccount(defaultAccount: string | number): CLIConfig | null {
    if (!this.config) {
      throwErrorWithMessage(`${i18nKey}.noConfigLoaded`);
    }
    if (
      !defaultAccount ||
      (typeof defaultAccount !== 'number' && typeof defaultAccount !== 'string')
    ) {
      throwErrorWithMessage(`${i18nKey}.updateDefaultAccount`);
    }

    this.config.defaultAccount = defaultAccount;
    return this.write();
  }

  /**
   * @throws {Error}
   */
  renameAccount(currentName: string, newName: string): void {
    if (!this.config) {
      throwErrorWithMessage(`${i18nKey}.noConfigLoaded`);
    }
    const accountId = this.getAccountId(currentName);
    let accountConfigToRename: CLIAccount | null = null;

    if (accountId) {
      accountConfigToRename = this.getAccount(accountId);
    }

    if (!accountConfigToRename) {
      throwErrorWithMessage(`${i18nKey}.renameAccount`, { currentName });
    }

    if (accountId) {
      this.updateAccount({ accountId, name: newName });
    }

    if (accountConfigToRename.name === this.getDefaultAccount()) {
      this.updateDefaultAccount(newName);
    }
  }

  /**
   * @throws {Error}
   */
  removeAccountFromConfig(nameOrId: string | number): boolean {
    if (!this.config) {
      throwErrorWithMessage(`${i18nKey}.noConfigLoaded`);
    }
    const accountId = this.getAccountId(nameOrId);

    if (!accountId) {
      throwErrorWithMessage(`${i18nKey}.removeAccountFromConfig`, { nameOrId });
    }

    let removedAccountIsDefault = false;
    const accountConfig = this.getAccount(accountId);

    if (accountConfig) {
      debug(`${i18nKey}.removeAccountFromConfig`, { accountId });
      const index = this.getConfigAccountIndex(accountId);
      this.config.accounts.splice(index, 1);

      if (this.getDefaultAccount() === accountConfig.name) {
        removedAccountIsDefault = true;
      }

      this.write();
    }

    return removedAccountIsDefault;
  }

  /**
   * @throws {Error}
   */
  updateDefaultMode(defaultMode: string): CLIConfig | null {
    if (!this.config) {
      throwErrorWithMessage(`${i18nKey}.noConfigLoaded`);
    }
    const ALL_MODES = Object.values(DEFAULT_MODES);
    if (!defaultMode || !ALL_MODES.find(m => m === defaultMode)) {
      throwErrorWithMessage(`${i18nKey}.updateDefaultMode`, {
        defaultMode,
        validModes: commaSeparatedValues(ALL_MODES),
      });
    }

    this.config.defaultMode = defaultMode;
    return this.write();
  }

  /**
   * @throws {Error}
   */
  updateHttpTimeout(timeout: string): CLIConfig | null {
    if (!this.config) {
      throwErrorWithMessage(`${i18nKey}.noConfigLoaded`);
    }
    const parsedTimeout = parseInt(timeout);
    if (isNaN(parsedTimeout) || parsedTimeout < MIN_HTTP_TIMEOUT) {
      throwErrorWithMessage(`${i18nKey}.updateHttpTimeout`, {
        timeout,
        minTimeout: MIN_HTTP_TIMEOUT,
      });
    }

    this.config.httpTimeout = parsedTimeout;
    return this.write();
  }

  /**
   * @throws {Error}
   */
  updateAllowUsageTracking(isEnabled: boolean): CLIConfig | null {
    if (!this.config) {
      throwErrorWithMessage(`${i18nKey}.noConfigLoaded`);
    }
    if (typeof isEnabled !== 'boolean') {
      throwErrorWithMessage(`${i18nKey}.updateAllowUsageTracking`, {
        isEnabled: `${isEnabled}`,
      });
    }

    this.config.allowUsageTracking = isEnabled;
    return this.write();
  }
}

export default new CLIConfiguration();