import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ICON_SHAPES, iconPrimitives, type IconName } from './icon-shapes';

// Baselines captured from the previous project-created SVG templates, not the new renderer.
const originalGeometry: Record<IconName, string> = {
  "undo": "29be15ab58a37487c52219365d2e1b386ee139f39425c05c6d6af670b791eebf",
  "redo": "4667c8882afcaba7774283a3dada386b6bdfc83e243a6247ea9e35a9cc6be2bb",
  "chevron-left": "4583ea478572be39f8f546abb4f0912f6e7e7c2dfd6b472cafd39f1237e3b92d",
  "pull": "b43079a12187e918c89274c76a5fbfcc14fd5ead15973ec7562d3db77b120fd3",
  "push": "067a81bca088790886a99228c15ddd52d925b145edd411381e93bc69edff9581",
  "branch": "ba2275e4384bc5f3a784e28acf506e465a0e7137cca80a702699e2da472f3934",
  "archive": "286591e7bf10dff5579d7e998f1e42b1379254cc8d7aacc5e35b66606ac8f190",
  "archive-restore": "3d5659f603f5f8c9326e0b99656ce115ffadd9753d8105b9c06dca0c34e9cead",
  "activity": "c1858c281f399f6d49231da8868affc7ba0c185965b08a145c587b42f220e6a8",
  "bell": "26369a6daaee172e3bc8520a594c437b2e62fc85d6e751a792d794aedda49319",
  "clock": "258f823657d8501f80af3e8d5d8ed015c42ddef4ac9f25950b4907bdab14eebf",
  "columns": "7ae9cd53d3ea262ca0ba04f6fc3714b32acb1961647e50a5bfc763bdcc3594f0",
  "filter": "0bbd91304035e4652042ff15a1fd61706a2ee4151217c1e3ec9b3b2863b15133",
  "history": "32ef7bf960e8aa805321e6c7339691118079f0d6894ed427d8122430f0d9b36b",
  "user": "41d61b862ae4a99de8730891365d7f08857e9776f86c4c525523a8ae58ed7937",
  "globe": "a9f806f1c516f1dfcf2518c4f477e473f965555e19b6353bd29d9913a02f91f2",
  "link": "eee688098f2a91bbecfb562c02edfcec1330ab4da149a4de02bbef841fcc73b2",
  "refresh": "bd63bfb961894f956af8cee8a219b7fb0240b39565aa5edc5dfa5c7ac1aff809",
  "remote": "c8bfe15a3c7b82caf2fe4a478e2e69dfa25f7b643362987aad869fee56536b61",
  "search": "dd0f028c7aaa1323ddc670132d5fb9ff020d0e1501c55d5f466054b089d9db25",
  "server": "78e65d806641e3c4dad1dfb76addb5924a6cd680b6f9c79ef4ba259145585d41",
  "settings": "d72b9ab9306d7e2c8baa6c4ec630e027bcd3fb1ab7f86f4aab97bb52acd6e881",
  "star": "221179ca565c95c6c475e10d9a587ad75b98351f5bd04ffc91132e83425dbb1a",
  "keyboard": "0109029f507f251da0d81a4befa6f9d25fdff2f06d5d4cbc1c895f50aaf6d76c",
  "minus": "6d2cb4a27337cafd749857b18a991eb906fc5ab2b619f3d886542381988feb37",
  "plus": "ee5aca34b506e4b1a4b7cbee23986fd0267297f0d965b9ff89e2b87ff53e46cc",
  "x": "723f841552d4a2453fbc7a0f8c7ae5c228aafb0da54caef60974d63539e9fa53",
  "chevron-down": "c59bc0b1ce2faba67d29970b6c3e2e181472ef0ed28a9bcf15dd55a693fa70ae",
  "chevron-up": "534a76bd3316ffeea4343127295b40f698730d3192c28389a6c8fc0191f24814",
  "chevron-right": "2d64bb8792049ad2e6af547040fe4627f3a31c257636a19df1d550c5df24b8d0",
  "tag": "9f16e299a1248e14efbd47b547802d2c62f85c93e9e519c4bcf2f3953f7a6ae8",
  "terminal": "8eabc40bd284332796ffa1f066e9e5b96f979f10ff3dfdb57011e389a669a526",
  "external-terminal": "c316154d8e90dedf13415d885118b40e57d42d84c37ef16e5c36a673668d3e08",
  "repo": "0e6029ae1889ac0838c673edbfb0c53f8854b3ddde10c7987dceb945f128d7b2",
  "folder-git": "c3b41d7029e42a1c0c8ecf9e599dcc243d16c6d5e2ff95ab17611d86a4803e9e",
  "copy": "5b811583c8b7bfbecf6f62f58f67c43ac9e1969db989488ec711b3a90bd19bea",
  "check": "4187bd0a6b00ab904ad1524c5e8d17fe1f570e1ad50a4cee5c81ac2504fe2fbf",
  "warning": "f71e589800c5c4b6ec1377ebf6fb0490d0912ab3f710b89c16b70427cb233209",
  "git-commit": "c55e15ae07f05e7b5cdbe62086faa691eba489ecf9d5670fb65b85fcfca58760",
  "merge": "43446d3b4e2c7e876dd4dab5ccd4771efcf671842591ef97a78ebcde9e7bbffb",
  "maximize": "74b7dcd4a03e5943b705ca4a8517f312eb483b16d0dcc769b3a86c6f4d3b285d",
  "more": "40a5c3807132c9fdc979999960cb262734be51d5f5800555d3f1e037b8756fb8",
  "edit": "5dff2646089b38bf2f921afb3f78ffa2714813959b4c4d459ed6a3e938aff3c2",
  "eye": "07fde77310b0121af35e2835cafad77a6525f96f39d389371b50754c6e263e51",
  "eye-off": "00f0b1a3d4fce3e3a1f3f7bc239eec2eee4d2ffc99ac18c86b9193e968432f61",
  "trash": "cc8dedad699bc36c8eb7fbf60f0e5987b4d725419786aff96701be98d4c336df",
  "file": "532459db48f0a65b7509fcf1d66f7bee6f89aadcf5c6d61058dfe25eb1ab15eb",
  "cherry-pick": "94e0270aa7763ae398e28523b14bc0ea1bda2d4fc59677055b3e1f1d9abb2901",
  "revert": "93bc0cb0ba612f14740341eacfc6cb58b974f797ede9169c7c916680d0b96757",
  "reset": "6e4b04b830c577261e2a98ef1d356a3bcddcb16a50957d7ec35df01769ec8968",
  "panel-left": "470716ee5ff9e88b45977575b518b86d1e59e85bdde0589eaad4729661035883",
  "panel-right": "ddbbd437fd14a10cb021399d99b8339a15b24be0f58ef2265dfbfc09a623e404",
  "pin": "db10668d9d7e01e1a01dc1d6e657bb0a5a8da2183be7c0600a86d6482278ec19"
};

describe('original icon geometry', () => {
  it('keeps unknown names empty, including inherited object-property names', () => {
    for (const name of ['missing-icon', 'constructor', '__proto__', 'toString']) {
      expect(iconPrimitives(name)).toEqual([]);
    }
    expect(iconPrimitives('branch')).toBe(ICON_SHAPES.branch);
  });
  it('preserves every icon, primitive order and exact attribute value', () => {
    expect(Object.keys(ICON_SHAPES).sort()).toEqual(Object.keys(originalGeometry).sort());
    for (const name of Object.keys(originalGeometry) as IconName[]) {
      expect(createHash('sha256').update(JSON.stringify(ICON_SHAPES[name])).digest('hex'), name)
        .toBe(originalGeometry[name]);
    }
  });

  it('contains only data-bound path, circle and rectangle primitives', () => {
    for (const primitives of Object.values(ICON_SHAPES)) {
      expect(primitives.length).toBeGreaterThan(0);
      for (const primitive of primitives) {
        expect(['path', 'circle', 'rect']).toContain(primitive.kind);
        expect(Object.keys(primitive).some(key => /^(on|href|style)/i.test(key))).toBe(false);
      }
    }
  });
});
