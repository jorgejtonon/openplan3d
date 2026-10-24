/** Photo Sphere (GPano) metadata, so galleries, Google Photos, Facebook and VR viewers
 * open the exported JPEG as an interactive 360° panorama. */
export function panoramaXmp(width: number, height: number): string {
  return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/"'
    + ' GPano:ProjectionType="equirectangular" GPano:UsePanoramaViewer="True"'
    + ` GPano:FullPanoWidthPixels="${width}" GPano:FullPanoHeightPixels="${height}"`
    + ` GPano:CroppedAreaImageWidthPixels="${width}" GPano:CroppedAreaImageHeightPixels="${height}"`
    + ' GPano:CroppedAreaLeftPixels="0" GPano:CroppedAreaTopPixels="0"/>'
    + '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
}

const XMP_NAMESPACE = 'http://ns.adobe.com/xap/1.0/\0';

/** Inserts an XMP APP1 segment into a baseline JPEG, after SOI and any JFIF APP0 segment. */
export function injectPanoramaXmp(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Not a JPEG image');
  const payload = new TextEncoder().encode(XMP_NAMESPACE + panoramaXmp(width, height));
  const segmentLength = payload.length + 2;
  if (segmentLength > 0xffff) throw new Error('XMP packet too large');
  let insertAt = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0 && jpeg.length > 6) insertAt = 4 + ((jpeg[4] << 8) | jpeg[5]);
  const out = new Uint8Array(jpeg.length + 4 + payload.length);
  out.set(jpeg.subarray(0, insertAt), 0);
  out.set([0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff], insertAt);
  out.set(payload, insertAt + 4);
  out.set(jpeg.subarray(insertAt), insertAt + 4 + payload.length);
  return out;
}

/** Equirectangular size for the renderer's limits: 2:1, at most 4096 px wide. */
export function panoramaSize(maxTextureSize: number): { width: number; height: number } {
  const width = maxTextureSize >= 4096 ? 4096 : maxTextureSize >= 2048 ? 2048 : 1024;
  return { width, height: width / 2 };
}
