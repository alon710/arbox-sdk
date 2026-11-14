declare const __ARBOX_SDK_VERSION__: string | undefined;

export const VERSION: string =
  typeof __ARBOX_SDK_VERSION__ === 'string' ? __ARBOX_SDK_VERSION__ : '0.0.0-development';
