/**
 * Municipality coordinates for Iloilo Province, DERIVED from PPDO's LMB
 * barangay point layer.
 *
 * GENERATED FILE -- do not edit by hand.
 *   Source:    ml-service/data_pipeline/reference/lmb_barangay_points_iloilo.csv
 *   Generator: scripts/build_municipality_coordinates.py
 *
 * Each value is the mean of that municipality's barangay points, which is the
 * same centroid `ml-service/common/geography.py` gives the optimizer. That
 * shared derivation is the point: this table was previously hand-maintained
 * approximate coordinates, and it had drifted from the authoritative data by a
 * median of 5.8 km and as much as 43.9 km (San Rafael) -- far enough to place
 * a pin in the wrong part of the province on a map used to decide where
 * inspectors go.
 *
 * Centroid-level, not survey-grade: a project is placed at its municipality's
 * centre, not its site. Barangay-level siting needs barangay carried through
 * feature_engineering.py, which it currently is not.
 *
 * Iloilo City is the one hand-set entry -- a highly urbanized city outside the
 * Provincial Planning and Development Office's remit, so the provincial layer
 * holds no points for it.
 */

export const MUNICIPALITY_COORDINATES: Record<string, [number, number]> = {
  "Ajuy": [11.154094, 123.018187], // 31 barangay points
  "Alimodian": [10.840545, 122.403876], // 27 barangay points
  "Anilao": [10.992108, 122.732970], // 18 barangay points
  "Badiangan": [10.990672, 122.533215], // 28 barangay points
  "Balasan": [11.460227, 123.081762], // 20 barangay points
  "Banate": [11.030117, 122.798519], // 17 barangay points
  "Barotac Nuevo": [10.906393, 122.715573], // 27 barangay points
  "Barotac Viejo": [11.070074, 122.856330], // 24 barangay points
  "Batad": [11.408440, 123.104216], // 21 barangay points
  "Bingawan": [11.182844, 122.563007], // 9 barangay points
  "Cabatuan": [10.887211, 122.493644], // 39 barangay points
  "Calinog": [11.145251, 122.498223], // 53 barangay points
  "Carles": [11.512966, 123.174595], // 23 barangay points
  "Concepcion": [11.213843, 123.119066], // 23 barangay points
  "Dingle": [11.002295, 122.664641], // 24 barangay points
  "Dueñas": [11.052807, 122.584381], // 35 barangay points
  "Dumangas": [10.834005, 122.700882], // 30 barangay points
  "Estancia": [11.458681, 123.137307], // 15 barangay points
  "Guimbal": [10.688384, 122.304941], // 15 barangay points
  "Igbaras": [10.736425, 122.253310], // 32 barangay points
  "Janiuay": [10.986900, 122.453919], // 44 barangay points
  "Lambunao": [11.070697, 122.483396], // 67 barangay points
  "Leganes": [10.788362, 122.592253], // 14 barangay points
  "Lemery": [11.233967, 122.913250], // 31 barangay points
  "Leon": [10.812876, 122.350035], // 75 barangay points
  "Maasin": [10.914630, 122.428305], // 42 barangay points
  "Miagao": [10.674062, 122.199274], // 91 barangay points
  "Mina": [10.937222, 122.577983], // 22 barangay points
  "New Lucena": [10.873121, 122.577284], // 19 barangay points
  "Oton": [10.712123, 122.464320], // 16 barangay points
  "Passi City": [11.145957, 122.634464], // 46 barangay points
  "Pavia": [10.773509, 122.535339], // 17 barangay points
  "Pototan": [10.931921, 122.630719], // 35 barangay points
  "San Dionisio": [11.323320, 123.085659], // 24 barangay points
  "San Enrique": [11.096543, 122.696519], // 26 barangay points
  "San Joaquin": [10.590615, 122.081582], // 69 barangay points
  "San Miguel": [10.785416, 122.462601], // 4 barangay points
  "San Rafael": [11.165105, 122.839635], // 6 barangay points
  "Santa Barbara": [10.824062, 122.538525], // 51 barangay points
  "Sara": [11.270530, 123.003290], // 34 barangay points
  "Tigbauan": [10.715313, 122.374215], // 39 barangay points
  "Tubungan": [10.791891, 122.297169], // 39 barangay points
  "Zarraga": [10.834971, 122.622842], // 20 barangay points
  "Iloilo City": [10.720200, 122.562100], // approximate; outside the provincial LMB layer
};

export const ILOILO_PROVINCE_CENTER: [number, number] = [11.0, 122.65];
export const ILOILO_PROVINCE_DEFAULT_ZOOM = 9;

/** Resolves a canonicalized municipality name to map coordinates, falling
 * back to the province center (with a wider default zoom, handled by the
 * caller) when the municipality is unmapped/unrecognized. */
export function resolveMunicipalityCoordinates(
  municipality: string | null | undefined
): [number, number] {
  if (!municipality) return ILOILO_PROVINCE_CENTER;
  return MUNICIPALITY_COORDINATES[municipality] ?? ILOILO_PROVINCE_CENTER;
}
