/** Geographic primitives shared by client and engine. */

/** A cell identifier of the form `r041c112` (row, then column). ARCHITECTURE §3. */
export type CellId = string;

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** Zero-based grid coordinates. Row 0 is the southern edge, column 0 the western edge. */
export interface RowCol {
  readonly row: number;
  readonly col: number;
}

/** Axis-aligned lat/lng rectangle covered by a cell. */
export interface CellBounds {
  readonly south: number;
  readonly north: number;
  readonly west: number;
  readonly east: number;
}

/** Thrown when a coordinate or cell id falls outside the launch grid (MECHANICS §1). */
export class OutOfGridError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutOfGridError';
  }
}
