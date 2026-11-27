const retryParameter = '__watchly_reload';

export const deploymentRetryNavigation = new RegExp(`[?&]${retryParameter}=1(?:&|$)`);

export function isAssetLoadError(error) {
    const message = typeof error?.message === 'string' ? error.message : '';
    return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css|loading chunk .+ failed/i.test(message);
}

export function deploymentRetryUrl(href) {
    const url = new URL(href);
    if (url.searchParams.has(retryParameter)) return null;
    url.searchParams.set(retryParameter, '1');
    return url.href;
}

export function cleanDeploymentRetryUrl(href) {
    const url = new URL(href);
    if (!url.searchParams.has(retryParameter)) return null;
    url.searchParams.delete(retryParameter);
    return url.href;
}
