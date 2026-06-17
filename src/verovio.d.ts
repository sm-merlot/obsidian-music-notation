// Verovio ships no type declarations. Minimal ambient types for the bits we use:
// the single-file WASM module factory (verovio/wasm) and the toolkit (verovio/esm).

declare module "verovio/wasm" {
	/** Emscripten module factory. Resolves once the WASM runtime is ready. */
	const createVerovioModule: (moduleArg?: Record<string, unknown>) => Promise<unknown>;
	export default createVerovioModule;
}

declare module "verovio/esm" {
	export class VerovioToolkit {
		constructor(module: unknown);
		setOptions(options: Record<string, unknown>): void;
		loadData(data: string): boolean;
		getPageCount(): number;
		renderToSVG(page: number): string;
		getLog(): string;
		destroy(): void;
	}
}
