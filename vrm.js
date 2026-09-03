/* GLB -> VRM 0.x converter for Gimboz.
 * Pure JSON surgery on the glTF chunk: no mesh, texture or skin data is touched.
 * Works because every Gimboz shares the same UE5 mannequin skeleton, so the humanoid
 * bone table below is written once and is correct for all 4443 tokens.
 * Runs in the browser (window.GimbozVRM) and in Node (module.exports) for testing.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GimbozVRM = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MAGIC = 0x46546c67, JSON_T = 0x4e4f534a, BIN_T = 0x004e4942;

  // VRM humanoid bone -> UE5 mannequin bone name. `_l` is the character's left (+X in glTF here).
  const BONES = {
    hips: 'pelvis', spine: 'spine_01', chest: 'spine_03', upperChest: 'spine_05',
    neck: 'neck_01', head: 'head', leftEye: 'eye_l', rightEye: 'eye_r',
    leftShoulder: 'clavicle_l', leftUpperArm: 'upperarm_l', leftLowerArm: 'lowerarm_l', leftHand: 'hand_l',
    rightShoulder: 'clavicle_r', rightUpperArm: 'upperarm_r', rightLowerArm: 'lowerarm_r', rightHand: 'hand_r',
    leftUpperLeg: 'thigh_l', leftLowerLeg: 'calf_l', leftFoot: 'foot_l', leftToes: 'ball_l',
    rightUpperLeg: 'thigh_r', rightLowerLeg: 'calf_r', rightFoot: 'foot_r', rightToes: 'ball_r',
  };
  // Gimboz hands: thumb + index + middle + ring. No little finger, so it is simply not mapped.
  for (const side of ['left', 'right']) {
    const s = side[0];
    for (const [f, ue] of [['Thumb', 'thumb'], ['Index', 'index'], ['Middle', 'middle'], ['Ring', 'ring']]) {
      BONES[`${side}${f}Proximal`] = `${ue}_01_${s}`;
      BONES[`${side}${f}Intermediate`] = `${ue}_02_${s}`;
      BONES[`${side}${f}Distal`] = `${ue}_03_${s}`;
    }
  }
  // Morph target name (from our Blender face rig) -> VRM 0.x preset
  const PRESETS = { A: 'a', I: 'i', U: 'u', E: 'e', O: 'o', Blink: 'blink', Blink_L: 'blink_l', Blink_R: 'blink_r', Joy: 'joy', Angry: 'angry', Sorrow: 'sorrow', Fun: 'fun' };
  const PRESET_ORDER = ['neutral', 'a', 'i', 'u', 'e', 'o', 'blink', 'joy', 'angry', 'sorrow', 'fun', 'lookup', 'lookdown', 'lookleft', 'lookright', 'blink_l', 'blink_r'];

  function parseGLB(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== MAGIC) throw new Error('Not a GLB file');
    let off = 12, json = null, bin = null;
    while (off < buf.byteLength) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      const chunk = buf.slice(off + 8, off + 8 + len);
      if (type === JSON_T) json = JSON.parse(new TextDecoder().decode(chunk));
      else if (type === BIN_T) bin = chunk;
      off += 8 + len;
    }
    if (!json) throw new Error('GLB has no JSON chunk');
    return { json, bin };
  }

  function packGLB(json, bin) {
    const enc = new TextEncoder().encode(JSON.stringify(json));
    const jpad = (4 - (enc.byteLength % 4)) % 4;
    const bpad = bin ? (4 - (bin.byteLength % 4)) % 4 : 0;
    const total = 12 + 8 + enc.byteLength + jpad + (bin ? 8 + bin.byteLength + bpad : 0);
    const out = new ArrayBuffer(total), dv = new DataView(out), u8 = new Uint8Array(out);
    dv.setUint32(0, MAGIC, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    let off = 12;
    dv.setUint32(off, enc.byteLength + jpad, true); dv.setUint32(off + 4, JSON_T, true); off += 8;
    u8.set(enc, off); off += enc.byteLength;
    for (let i = 0; i < jpad; i++) u8[off++] = 0x20;
    if (bin) {
      dv.setUint32(off, bin.byteLength + bpad, true); dv.setUint32(off + 4, BIN_T, true); off += 8;
      u8.set(new Uint8Array(bin), off); off += bin.byteLength; // zero padding already there
    }
    return out;
  }

  /** Convert a Gimboz GLB ArrayBuffer to a VRM 0.x ArrayBuffer. Returns { buffer, report }. */
  function convert(buf, opts = {}) {
    const { json, bin } = parseGLB(buf);
    const nodes = json.nodes || [];
    const byName = {}; nodes.forEach((n, i) => { if (n.name && !(n.name in byName)) byName[n.name] = i; });
    const report = { mapped: [], missing: [], expressions: [], flipped: false };

    // --- humanoid ---
    const humanBones = [];
    for (const [vrm, ue] of Object.entries(BONES)) {
      if (ue in byName) { humanBones.push({ bone: vrm, node: byName[ue], useDefaultValues: true }); report.mapped.push(vrm); }
      else report.missing.push(vrm);
    }
    for (const req of ['hips', 'spine', 'head', 'leftUpperArm', 'leftHand', 'leftUpperLeg', 'leftFoot'])
      if (!(BONES[req] in byName)) throw new Error(`Required bone ${BONES[req]} not found; is this a Gimboz GLB?`);

    // --- expressions: bind every mesh that carries a named morph target ---
    // Default morph weights must be 0 or the importer shows every expression at once (Blender can export them as 1).
    const groups = {};
    (json.meshes || []).forEach((m, mi) => {
      if (Array.isArray(m.weights)) m.weights = m.weights.map(() => 0);
      const names = (m.extras && m.extras.targetNames) || [];
      names.forEach((n, ti) => {
        const preset = PRESETS[n]; if (!preset) return;
        (groups[preset] = groups[preset] || []).push({ mesh: mi, index: ti, weight: 100 });
      });
    });
    const blendShapeGroups = PRESET_ORDER.map((p) => ({
      name: p === 'neutral' ? 'Neutral' : p.toUpperCase(), presetName: p, binds: groups[p] || [], materialValues: [], isBinary: false,
    }));
    report.expressions = Object.keys(groups);

    // --- face the VRM 0.x way: 0.x models face -Z in glTF, our GLB faces +Z, so yaw the scene root 180deg ---
    nodes.forEach((n) => { if (Array.isArray(n.weights)) n.weights = n.weights.map(() => 0); });
    const scene = json.scenes[json.scene || 0];
    if (opts.flip !== false) {
      let rootIdx;
      if (scene.nodes.length === 1 && !nodes[scene.nodes[0]].rotation && !nodes[scene.nodes[0]].scale && !nodes[scene.nodes[0]].translation) {
        rootIdx = scene.nodes[0];
      } else {
        nodes.push({ name: 'VRM_Root', children: scene.nodes.slice() }); rootIdx = nodes.length - 1; scene.nodes = [rootIdx];
      }
      nodes[rootIdx].rotation = [0, 1, 0, 0];
      report.flipped = true;
    }

    // --- materials: keep the glTF PBR as-is ---
    const materialProperties = (json.materials || []).map((m) => ({
      name: m.name || 'Material', shader: 'VRM_USE_GLTFSHADER', renderQueue: 2000,
      floatProperties: {}, vectorProperties: {}, textureProperties: {}, keywordMap: {}, tagMap: {},
    }));

    const head = byName[BONES.head];
    const curve = { curve: [0, 0, 0, 1, 1, 1, 1, 0], xRange: 90, yRange: 10 };
    json.extensionsUsed = Array.from(new Set([...(json.extensionsUsed || []), 'VRM']));
    json.extensions = json.extensions || {};
    json.extensions.VRM = {
      exporterVersion: 'gimboz-3d-pull',
      specVersion: '0.0',
      meta: {
        title: opts.title || 'Gimboz', version: '1', author: opts.author || 'Ape Church', contactInformation: 'https://ape.church',
        reference: opts.reference || 'https://gimboz-3d.vercel.app', texture: -1,
        allowedUserName: 'OnlyAuthor', violentUssageName: 'Disallow', sexualUssageName: 'Disallow', commercialUssageName: 'Disallow',
        otherPermissionUrl: '', licenseName: 'Other', otherLicenseUrl: 'https://ape.church',
      },
      humanoid: {
        humanBones, armStretch: 0.05, legStretch: 0.05, upperArmTwist: 0.5, lowerArmTwist: 0.5,
        upperLegTwist: 0.5, lowerLegTwist: 0.5, feetSpacing: 0, hasTranslationDoF: false,
      },
      firstPerson: {
        firstPersonBone: head, firstPersonBoneOffset: { x: 0, y: 0.06, z: 0 }, meshAnnotations: [],
        lookAtTypeName: 'Bone', lookAtHorizontalInner: curve, lookAtHorizontalOuter: curve, lookAtVerticalDown: curve, lookAtVerticalUp: curve,
      },
      blendShapeMaster: { blendShapeGroups },
      secondaryAnimation: { boneGroups: [], colliderGroups: [] },
      materialProperties,
    };
    return { buffer: packGLB(json, bin), report };
  }

  return { convert, parseGLB, packGLB, BONES, PRESETS };
});
