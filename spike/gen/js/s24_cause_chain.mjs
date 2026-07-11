function loadSigningKey(path) {
  throw new Error(`key file missing at ${path}`);
}

function initSigner() {
  try {
    return loadSigningKey("/etc/app/signing.pem");
  } catch (err) {
    throw new Error("signer initialization failed", { cause: err });
  }
}

initSigner();
