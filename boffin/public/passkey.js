export function supportsPasskey() {
  return window.isSecureContext && typeof PublicKeyCredential === 'function';
}

export async function createPasskey(options) {
  const credential = await navigator.credentials.create({ publicKey: prepareCreation(options) });
  if (!credential) {
    throw new Error('The passkey was not accepted.');
  }
  return serialize(credential);
}

export async function getPasskey(options) {
  const credential = await navigator.credentials.get({ publicKey: prepareRequest(options) });
  if (!credential) {
    throw new Error('The passkey was not accepted.');
  }
  return serialize(credential);
}

// The person decided not to create a passkey on a device that already holds one of the
// people in the conversation.
export class JoinDeclinedError extends Error {
  constructor() {
    super('The join was cancelled.');
    this.name = 'JoinDeclinedError';
  }
}

// Creates the passkey for a join. Its options exclude the passkeys of the owner and the
// current members, so a device that already holds one refuses. The person then chooses:
// continue, which creates another passkey and joins as a new person, or cancel.
export async function createJoinPasskey(options, { confirmSameDevice, create = createPasskey }) {
  try {
    return await create(options);
  } catch (error) {
    if (error?.name !== 'InvalidStateError') {
      throw error;
    }
    if (!(await confirmSameDevice())) {
      throw new JoinDeclinedError();
    }
    return create({ ...options, excludeCredentials: [] });
  }
}

function prepareCreation(options) {
  return {
    ...options,
    challenge: bytes(options.challenge),
    user: { ...options.user, id: bytes(options.user.id) },
    excludeCredentials: (options.excludeCredentials ?? []).map((item) => ({ ...item, id: bytes(item.id) })),
  };
}

function prepareRequest(options) {
  return {
    ...options,
    challenge: bytes(options.challenge),
    allowCredentials: (options.allowCredentials ?? []).map((item) => ({ ...item, id: bytes(item.id) })),
  };
}

function serialize(credential) {
  const response = credential.response;
  const body = {
    id: credential.id,
    type: credential.type,
    response: {
      clientDataJSON: text(response.clientDataJSON),
    },
  };
  if (response.attestationObject) {
    body.response.attestationObject = text(response.attestationObject);
  }
  if (response.authenticatorData) {
    body.response.authenticatorData = text(response.authenticatorData);
    body.response.signature = text(response.signature);
  }
  return body;
}

function bytes(value) {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function text(buffer) {
  const view = new Uint8Array(buffer);
  let binary = '';
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
