declare module '@consenlabs/tcx-wasm/tcx_wasm.js' {
  export default function init(input?: unknown): Promise<void>
  export function create_keystore(param: string): string
  export function derive_accounts(param: string): string
  export function sign_tx(param: string): string
}
