/** OpenLeads Studio sends no analytics. These keep the editor's call sites unchanged. */
export type ZoryEvent = string;
export type EventProps = Record<string, string | number | boolean>;
export function track(_event: ZoryEvent, _props?: EventProps): void {}
export function trackFunnel(_event: string, _props?: object): void {}
export function trackFirstEdit(_commandType: string): void {}
export function resetSession(): void {}
