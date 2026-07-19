/** One installed pack, as returned by GET /api/packs. `pack` is the raw pack.json. */
export interface PackEntry {
  id: string;
  dir: string;
  pack: unknown;
}

export interface PacksResponse {
  packs: PackEntry[];
}
