async function readManifest(url) {
  await new Promise((resolve) => setTimeout(resolve, 1));
  throw new Error(`manifest fetch failed: ${url} returned 503`);
}

async function deployRelease(env) {
  return readManifest(`https://cdn.internal/${env}/manifest.json`);
}

async function main() {
  await deployRelease("staging");
}

main();
