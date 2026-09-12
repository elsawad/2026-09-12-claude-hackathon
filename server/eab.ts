import { isInsideHRM } from "./geometry.js";

/**
 * CFIA's emerald ash borer regulated area (established after the 2018
 * Bedford, NS detection) covers essentially all of HRM. We don't have a
 * precise, current CFIA boundary file to check against on a hackathon
 * clock, so this is a documented simplification: treat "inside HRM" as
 * "inside the EAB regulated area." Named as a simplification, not hidden.
 */
export async function getEabFlag(lat: number, lng: number): Promise<boolean> {
  return isInsideHRM(lat, lng);
}
