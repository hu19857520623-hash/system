export declare function sanitizeCode128Text(value: string): string;
export declare function code128SymbolValues(text: string): number[];
/** Alternating bar/space widths, starting with a black bar. */
export declare function code128Widths(text: string): number[];
export declare function code128Svg(text: string, height?: number): string;
