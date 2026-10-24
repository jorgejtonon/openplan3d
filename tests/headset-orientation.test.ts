import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { deepestViewYaw, deviceQuaternion, dragQuaternion, headingOffset, headsetQuaternion, walkDirection, wallDistance, yawOf } from '$lib/utils/headsetOrientation';
import { injectPanoramaXmp, panoramaSize, panoramaXmp } from '$lib/utils/panoramaXmp';

const forward = (q: Quaternion) => new Vector3(0, 0, -1).applyQuaternion(q);

describe('headset orientation', () => {
  it('looks at the horizon when a portrait phone is held upright', () => {
    const f = forward(deviceQuaternion(0, 90, 0, 0));
    expect(f.y).toBeCloseTo(0, 6);
    expect(Math.hypot(f.x, f.z)).toBeCloseTo(1, 6);
  });

  it('looks at the horizon with the phone in landscape inside a headset', () => {
    // Landscape-left in a headset: screen angle 90°, device rolled onto its side.
    const f = forward(deviceQuaternion(0, 0, -90, 90));
    expect(Math.abs(f.y)).toBeLessThan(1e-6);
  });

  it('turns with the compass heading', () => {
    const a = yawOf(deviceQuaternion(0, 90, 0, 0));
    const b = yawOf(deviceQuaternion(90, 90, 0, 0));
    expect(b - a).toBeCloseTo(Math.PI / 2, 6);
  });

  it('recentres so the current phone heading shows the chosen model heading', () => {
    const device = deviceQuaternion(237, 90, 0, 0);
    const target = 0.4;
    const q = headsetQuaternion(device, headingOffset(device, target));
    expect(yawOf(q)).toBeCloseTo(target, 6);
    // The tilt (pitch) is preserved by the heading correction.
    expect(forward(q).y).toBeCloseTo(forward(device).y, 6);
  });

  it('walks along the gaze projected on the floor', () => {
    const level = walkDirection(dragQuaternion(0, 0));
    expect(level.x).toBeCloseTo(0, 6);
    expect(level.z).toBeCloseTo(-1, 6);
    const lookingDown = walkDirection(dragQuaternion(Math.PI / 2, -1.2));
    expect(Math.hypot(lookingDown.x, lookingDown.z)).toBeCloseTo(1, 6);
    expect(lookingDown.x).toBeCloseTo(-1, 6);
  });
});

describe('360° panorama metadata', () => {
  it('declares an equirectangular photo sphere with its size', () => {
    const xmp = panoramaXmp(4096, 2048);
    expect(xmp).toContain('GPano:ProjectionType="equirectangular"');
    expect(xmp).toContain('GPano:FullPanoWidthPixels="4096"');
    expect(xmp).toContain('GPano:FullPanoHeightPixels="2048"');
  });

  it('inserts the XMP segment after the JFIF header', () => {
    const jfif = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0x4a), 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9];
    const out = injectPanoramaXmp(new Uint8Array(jfif), 2048, 1024);
    const app1 = 2 + 2 + 0x10;
    expect([...out.subarray(0, app1)]).toEqual(jfif.slice(0, app1));
    expect(out[app1]).toBe(0xff);
    expect(out[app1 + 1]).toBe(0xe1);
    const length = (out[app1 + 2] << 8) | out[app1 + 3];
    const text = new TextDecoder().decode(out.subarray(app1 + 4, app1 + 2 + length));
    expect(text.startsWith('http://ns.adobe.com/xap/1.0/\0')).toBe(true);
    expect(text).toContain('GPano:CroppedAreaImageWidthPixels="2048"');
    expect([...out.subarray(app1 + 2 + length)]).toEqual(jfif.slice(app1));
  });

  it('rejects data that is not a JPEG', () => {
    expect(() => injectPanoramaXmp(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 10, 5)).toThrow(/Not a JPEG/);
  });

  it('chooses a 2:1 size within the GPU limit', () => {
    expect(panoramaSize(16384)).toEqual({ width: 4096, height: 2048 });
    expect(panoramaSize(4096)).toEqual({ width: 4096, height: 2048 });
    expect(panoramaSize(2048)).toEqual({ width: 2048, height: 1024 });
  });
});

describe('starting view', () => {
  const room = [
    { start: { x: 0, y: 0 }, end: { x: 750, y: 0 } }, { start: { x: 750, y: 0 }, end: { x: 750, y: 300 } },
    { start: { x: 750, y: 300 }, end: { x: 0, y: 300 } }, { start: { x: 0, y: 300 }, end: { x: 0, y: 0 } },
  ];
  it('measures the distance to the wall ahead', () => {
    expect(wallDistance({ x: 375, z: 150 }, 0, room)).toBeCloseTo(150); // -Z
    expect(wallDistance({ x: 375, z: 150 }, Math.PI / 2, room)).toBeCloseTo(375); // -X
  });
  it('looks along the long side of a 7.5 × 3 m living room', () => {
    const yaw = deepestViewYaw({ x: 375, z: 150 }, room);
    expect(Math.abs(Math.sin(yaw))).toBeGreaterThan(0.9);
  });
});
