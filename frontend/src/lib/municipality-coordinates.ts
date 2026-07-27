/**
 * Approximate town-center coordinates for Iloilo Province's 44 LGUs (42
 * municipalities + Iloilo City + Passi City), matching the
 * `MUNICIPALITY_REFERENCE` list used throughout `ml-service/data_pipeline/
 * preprocess.py` for entity resolution and canonicalization.
 *
 * CAVEAT — same treatment as `MUNICIPALITY_CLUSTERS` in
 * optimization_engine.py and `PRICES_DATASET_ID` in fetch_psa_data.py:
 * these are reasonable, general-knowledge approximate coordinates (town
 * poblacion/center), NOT surveyed centroids from an authoritative source
 * (PSGC, a GIS shapefile, or a geocoding API). They are accurate enough to
 * place a pin in roughly the right part of the province for a risk-overview
 * map, but should be verified/replaced with PSGC-sourced coordinates before
 * this map is used for anything requiring precise geographic accuracy.
 */

export const MUNICIPALITY_COORDINATES: Record<string, [number, number]> = {
  "Ajuy": [11.1167, 123.0333],
  "Alimodian": [10.8333, 122.4667],
  "Anilao": [10.7333, 122.8500],
  "Badiangan": [11.0167, 122.5667],
  "Balasan": [11.5333, 123.0167],
  "Banate": [11.0167, 122.8500],
  "Barotac Nuevo": [10.9500, 122.7333],
  "Barotac Viejo": [11.1667, 122.9000],
  "Batad": [11.4833, 123.0500],
  "Bingawan": [11.1000, 122.5000],
  "Cabatuan": [10.9500, 122.4833],
  "Calinog": [11.1167, 122.5333],
  "Carles": [11.5833, 123.1333],
  "Concepcion": [11.2333, 123.1167],
  "Dingle": [11.0000, 122.6667],
  "Dueñas": [10.9833, 122.6333],
  "Dumangas": [10.8333, 122.7167],
  "Estancia": [11.4667, 123.1500],
  "Guimbal": [10.6667, 122.3167],
  "Igbaras": [10.7167, 122.3667],
  "Iloilo City": [10.7202, 122.5621],
  "Janiuay": [10.9667, 122.5000],
  "Lambunao": [11.0667, 122.6167],
  "Leganes": [10.7833, 122.5833],
  "Lemery": [11.4667, 122.9500],
  "Leon": [10.7833, 122.3833],
  "Maasin": [10.8333, 122.4500],
  "Miagao": [10.6500, 122.2333],
  "Mina": [11.0000, 122.5333],
  "New Lucena": [10.8667, 122.5500],
  "Oton": [10.6833, 122.4667],
  "Passi City": [11.1050, 122.6417],
  "Pavia": [10.7667, 122.5500],
  "Pototan": [10.9444, 122.6333],
  "San Dionisio": [11.2833, 123.0333],
  "San Enrique": [11.0000, 122.7000],
  "San Joaquin": [10.6167, 122.1500],
  "San Miguel": [10.8333, 122.5833],
  "San Rafael": [11.0167, 122.4667],
  "Santa Barbara": [10.8167, 122.5333],
  "Sara": [11.2500, 123.0167],
  "Tigbauan": [10.6667, 122.3833],
  "Tubungan": [10.7667, 122.4000],
  "Zarraga": [10.8000, 122.5833],
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
