import { StatusCodeError, StatusCodeErrorContext } from '../types/Error';
import { HTTP_METHOD_VERBS, HTTP_METHOD_PREPOSITIONS } from '../constants/api';
import { i18n } from '../utils/lang';
import { throwError } from './standardErrors';
import { HubSpotAuthError } from './HubSpotAuthError';

function isApiStatusCodeError(err: StatusCodeError) {
  return (
    err.name === 'StatusCodeError' ||
    (err.statusCode && err.statusCode >= 100 && err.statusCode < 600)
  );
}

export function isMissingScopeError(err: StatusCodeError): boolean {
  return Boolean(
    err.name === 'StatusCodeError' &&
      err.statusCode === 403 &&
      err.error &&
      err.error.category === 'MISSING_SCOPES'
  );
}

export function isGatingError(err: StatusCodeError): boolean {
  return Boolean(
    err.name === 'StatusCodeError' &&
      err.statusCode === 403 &&
      err.error &&
      err.error.category === 'GATED'
  );
}

function isApiUploadValidationError(err: StatusCodeError): boolean {
  return Boolean(
    err.statusCode === 400 &&
      err.response &&
      err.response.body &&
      (err.response.body.message || err.response.body.errors)
  );
}

export function isSpecifiedHubSpotAuthError(
  err: HubSpotAuthError,
  { statusCode, category, subCategory }: Partial<HubSpotAuthError>
): boolean {
  const statusCodeErr = !statusCode || err.statusCode === statusCode;
  const categoryErr = !category || err.category === category;
  const subCategoryErr = !subCategory || err.subCategory === subCategory;
  return (
    err.name === 'HubSpotAuthError' &&
    statusCodeErr &&
    categoryErr &&
    subCategoryErr
  );
}

function parseValidationErrors(
  responseBody: {
    errors?: Array<StatusCodeError>;
    message?: string;
  } = { errors: [], message: '' }
) {
  const errorMessages = [];

  const { errors, message } = responseBody;

  if (message) {
    errorMessages.push(message);
  }

  if (errors) {
    const specificErrors = errors.map(error => {
      let errorMessage = error.message;
      if (error.errorTokens && error.errorTokens.line) {
        errorMessage = `line ${error.errorTokens.line}: ${errorMessage}`;
      }
      return errorMessage;
    });
    errorMessages.push(...specificErrors);
  }

  return errorMessages;
}

function logValidationErrors(error: StatusCodeError) {
  const { response = { body: undefined } } = error;
  const validationErrorMessages = parseValidationErrors(response.body);
  if (validationErrorMessages.length) {
    throwError(new Error(validationErrorMessages.join(' '), { cause: error }));
  }
}

export function throwStatusCodeError(
  error: StatusCodeError,
  context: StatusCodeErrorContext = {}
): never {
  const { statusCode, message, response } = error;
  const errorData = JSON.stringify({
    statusCode,
    message,
    url: response.request.href,
    method: response.request.method,
    response: response.body,
    headers: response.headers,
    context,
  });
  throw new Error(errorData, { cause: error });
}

export function throwApiStatusCodeError(
  error: StatusCodeError,
  context: StatusCodeErrorContext
): never {
  const i18nKey = 'errors.api';
  const { statusCode } = error;
  const { method } = error.options || {};
  const { projectName } = context;

  const isPutOrPost = method === 'PUT' || method === 'POST';
  const action =
    method && (HTTP_METHOD_VERBS[method] || HTTP_METHOD_VERBS.DEFAULT);
  const preposition =
    (method && HTTP_METHOD_PREPOSITIONS[method]) ||
    HTTP_METHOD_PREPOSITIONS.DEFAULT;

  const request = context.request
    ? `${action} ${preposition} "${context.request}"`
    : action;
  const messageDetail =
    request && context.accountId
      ? i18n(`${i18nKey}.messageDetail`, {
          request,
          accountId: context.accountId,
        })
      : 'request';

  const errorMessage: Array<string> = [];
  if (isPutOrPost && context.payload) {
    errorMessage.push(
      i18n(`${i18nKey}.unableToUpload`, { payload: context.payload })
    );
  }
  const isProjectMissingScopeError = isMissingScopeError(error) && projectName;
  const isProjectGatingError = isGatingError(error) && projectName;
  switch (statusCode) {
    case 400:
      errorMessage.push(i18n(`${i18nKey}.codes.400`, { messageDetail }));
      break;
    case 401:
      errorMessage.push(i18n(`${i18nKey}.codes.401`, { messageDetail }));
      break;
    case 403:
      if (isProjectMissingScopeError) {
        errorMessage.push(
          i18n(`${i18nKey}.codes.403MissingScope`, {
            accountId: context.accountId || '',
          })
        );
      } else if (isProjectGatingError) {
        errorMessage.push(
          i18n(`${i18nKey}.codes.403Gating`, {
            accountId: context.accountId || '',
          })
        );
      } else {
        errorMessage.push(i18n(`${i18nKey}.codes.403`, { messageDetail }));
      }
      break;
    case 404:
      if (context.request) {
        errorMessage.push(
          i18n(`${i18nKey}.codes.404Request`, {
            action: action || 'request',
            request: context.request,
            account: context.accountId || '',
          })
        );
      } else {
        errorMessage.push(i18n(`${i18nKey}.codes.404`, { messageDetail }));
      }
      break;
    case 429:
      errorMessage.push(i18n(`${i18nKey}.codes.429`, { messageDetail }));
      break;
    case 503:
      errorMessage.push(i18n(`${i18nKey}.codes.503`, { messageDetail }));
      break;
    default:
      if (statusCode && statusCode >= 500 && statusCode < 600) {
        errorMessage.push(
          i18n(`${i18nKey}.codes.500Generic`, { messageDetail })
        );
      } else if (statusCode && statusCode >= 400 && statusCode < 500) {
        errorMessage.push(
          i18n(`${i18nKey}.codes.400Generic`, { messageDetail })
        );
      } else {
        errorMessage.push(i18n(`${i18nKey}.codes.generic`, { messageDetail }));
      }
      break;
  }
  if (
    error?.error?.message &&
    !isProjectMissingScopeError &&
    !isProjectGatingError
  ) {
    errorMessage.push(error.error.message);
  }
  if (error.error && error.error.errors) {
    error.error.errors.forEach(err => {
      errorMessage.push('\n- ' + err.message);
    });
  }
  throwError(new Error(errorMessage.join(' '), { cause: error }));
}

export function throwApiError(
  error: StatusCodeError,
  context: StatusCodeErrorContext
): never {
  if (isApiStatusCodeError(error)) {
    throwApiStatusCodeError(error, context);
  }
  throwError(error);
}

export function throwApiUploadError(
  error: StatusCodeError,
  context: StatusCodeErrorContext
): never {
  if (isApiUploadValidationError(error)) {
    logValidationErrors(error);
  }
  throwApiError(error, context);
}