/**
 * Maps world-atlas (Natural Earth 110m) country features to ISO 3166-1 alpha-3.
 *
 * Only countries that a zone attributes heat to are listed; every other
 * feature renders as neutral land. world-atlas ships three features without a
 * numeric id (Kosovo, N. Cyprus, Somaliland), so those match by name and use
 * the conventional user-assigned codes.
 */
export const ATLAS_ID_TO_ISO3 = {
  "004": "AFG",
  "012": "DZA",
  "031": "AZE",
  "032": "ARG",
  "051": "ARM",
  "068": "BOL",
  "104": "MMR",
  "108": "BDI",
  "112": "BLR",
  "120": "CMR",
  "148": "TCD",
  "152": "CHL",
  "156": "CHN",
  "158": "TWN",
  "180": "COD",
  "196": "CYP",
  "231": "ETH",
  "232": "ERI",
  "233": "EST",
  "246": "FIN",
  "262": "DJI",
  "275": "PSE",
  "304": "GRL",
  "324": "GIN",
  "332": "HTI",
  "352": "ISL",
  "356": "IND",
  "360": "IDN",
  "364": "IRN",
  "368": "IRQ",
  "376": "ISR",
  "392": "JPN",
  "408": "PRK",
  "410": "KOR",
  "422": "LBN",
  "428": "LVA",
  "440": "LTU",
  "466": "MLI",
  "498": "MDA",
  "504": "MAR",
  "562": "NER",
  "566": "NGA",
  "578": "NOR",
  "586": "PAK",
  "591": "PAN",
  "608": "PHL",
  "616": "POL",
  "643": "RUS",
  "646": "RWA",
  "688": "SRB",
  "704": "VNM",
  "706": "SOM",
  "728": "SSD",
  "729": "SDN",
  "732": "ESH",
  "760": "SYR",
  "804": "UKR",
  "818": "EGY",
  "854": "BFA",
  "862": "VEN",
  "887": "YEM",
  "894": "ZMB",
} as const;

export const ATLAS_NAME_TO_ISO3 = {
  Kosovo: "XKX",
  "N. Cyprus": "CYN",
  Somaliland: "SOL",
} as const;

export type Iso3 =
  | (typeof ATLAS_ID_TO_ISO3)[keyof typeof ATLAS_ID_TO_ISO3]
  | (typeof ATLAS_NAME_TO_ISO3)[keyof typeof ATLAS_NAME_TO_ISO3];

/** Heat share per country: 1 = the zone's full score lands on that polygon. */
export type CountryShares = Partial<Record<Iso3, number>>;

function hasKey<T extends object>(obj: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function iso3ForAtlasFeature(id: string | number | undefined, name: string): Iso3 | null {
  if (id !== undefined) {
    const key = String(id).padStart(3, "0");
    if (hasKey(ATLAS_ID_TO_ISO3, key)) return ATLAS_ID_TO_ISO3[key];
    return null;
  }
  return hasKey(ATLAS_NAME_TO_ISO3, name) ? ATLAS_NAME_TO_ISO3[name] : null;
}
