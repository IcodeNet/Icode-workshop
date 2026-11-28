// The apps layout: a course whose steps are nested apps,
// `exercises/NN.<module>/NN.problem.<name>` with a matching `NN.solution.<name>`,
// opted into with `workshop.json` `{ "schemaVersion": 1, "format": "apps" }`.
//
// Courses in this layout carry a few fixed names of their own: a settings key
// in package.json (also the folder for hook files and the diff ignore file), an
// environment-variable prefix their hook scripts read, a browser-test import
// path and a video component. Icode reads these names as data so such courses
// run unchanged. It never installs, imports or runs any other workshop tooling.
// This module is the only place those names appear.

/** `workshop.json#format` value for the apps layout. */
export const APPS_FORMAT = "apps";

/** package.json key holding per-course and per-app settings; also the folder for hook files and `.diffignore`. */
export const APPS_SETTINGS_KEY = "epicshop";

/** Prefix of the playground variables that apps-layout hook scripts read (alongside `ICODE_PLAYGROUND_*`). */
export const APPS_HOOK_ENV_PREFIX = "EPICSHOP_PLAYGROUND_";

/** Import path that apps-layout browser tests use for the test runtime (alias of `@icodenet/workshop-test`). */
export const APPS_TEST_MODULE = "@epic-web/workshop-utils/test";

/** Video component used in apps-layout lessons (rendered like `<VideoEmbed>`). */
export const APPS_VIDEO_TAG = "EpicVideo";
