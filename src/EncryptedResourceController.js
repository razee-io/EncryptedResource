/**
 * Copyright 2019 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const objectPath = require('object-path');
const openpgp = require('openpgp');
const yaml = require('js-yaml');

const { CompositeController } = require('@razee/razeedeploy-core');


module.exports = class EncryptedResourceController extends CompositeController {
  constructor(params) {
    params.finalizerString = params.finalizerString || 'children.encryptedresource.deploy.razee.io';
    super(params);
  }

  async added() {
    // Get Private key and decrypt it for use
    const { secretkey, passphrase } = await this.getDecryptKey(objectPath.get(this.data, 'object.spec.auth', {}));
    const keyAsciiArmored = secretkey.toString().startsWith('-----');
    const { keys: [privateKey], err: keyErrors } = keyAsciiArmored ? await openpgp.key.readArmored(secretkey) : await openpgp.key.read(secretkey);
    if (keyErrors) {
      const keyErrorsCustomMsg = keyErrors.map(e => {
        e.message = `Failed to read privateKey: "${e.message}"`;
        return e;
      });
      return Promise.reject(keyErrorsCustomMsg);
    }
    if (!privateKey.isDecrypted() && passphrase !== undefined) {
      try {
        await privateKey.decrypt(passphrase);
        this.log.debug('PrivateKey decrypted successfully.. continuing');
      } catch (e) {
        e.message = `Failed to decrypt privateKey: "${e.message}"`;
        return Promise.reject(e);
      }
    } else if (!privateKey.isDecrypted() && passphrase === undefined) {
      return Promise.reject('PrivateKey is encrypted, but no passphrase was provided to decrypt it.. failing');
    } else if (privateKey.isDecrypted()) {
      this.log.debug('PrivateKey is already decrypted, no passphrase needed.. continuing');
    }

    // get resources and decrypt them using private key
    const errors = [];
    // Assumes: all resources are base64 encoded
    const resources = objectPath.get(this.data, 'object.spec.resources', []);
    let decryptedResources = [];
    for (let i = 0; i < resources.length; i++) {
      let r = resources[i];
      r = Buffer.from(r, 'base64');
      const resourceAsciiArmored = r.toString().startsWith('-----');
      try {
        const decrypted = await openpgp.decrypt({
          message: resourceAsciiArmored ? await openpgp.message.readArmored(r) : await openpgp.message.read(r),
          privateKeys: [privateKey]
        });
        let json = yaml.safeLoadAll(decrypted.data);
        json.forEach(dd => decryptedResources.push(dd));
      } catch (e) {
        e.message = `Failed to decrypt "spec.resources[${i}]": "${e.message}"`;
        errors.push(e);
      }
    }

    // apply resources to cluster
    for (let i = 0; i < decryptedResources.length; i++) {
      const dResource = decryptedResources[i];
      let kind = objectPath.get(dResource, 'kind');
      let group = objectPath.get(dResource, 'apiVersion');
      let name = objectPath.get(dResource, 'metadata.name');
      try {
        let rsp = await this.applyChild(dResource);
        if (!rsp.statusCode || rsp.statusCode < 200 || rsp.statusCode >= 300) {
          this.log.error(rsp);
          errors.push({ message: `${kind}.${group} "${name}" status ${rsp.statusCode} ${objectPath.get(rsp, 'body.reason', '')}.. see logs for details` });
        }
      } catch (e) {
        e.message = `Failed to apply child "${kind}.${group} ${name}": "${e.message}"`;
        errors.push(e);
      }
    }

    if (errors.length > 0) {
      let msg = `${errors.length} Errors occured while decrypting resources.. skipping reconcileChildren.`;
      this.log.warn(msg, this.selfLink);
      await this.updateRazeeLogs('warn', msg);
      return Promise.reject(errors);
    } else {
      await this.reconcileChildren();
    }
  }

  // Assumes: privateKeys and passphrases are be base64 encoded
  async getDecryptKey(authData) {
    const strKey = objectPath.get(authData, 'privateKey');
    const refKey = objectPath.get(authData, 'privateKeyRef');
    let secretkey;
    if (strKey) {
      secretkey = Buffer.from(strKey, 'base64');
    } else if (refKey) {
      const name = objectPath.get(refKey, 'valueFrom.secretKeyRef.name');
      const namespace = objectPath.get(refKey, 'valueFrom.secretKeyRef.namespace');
      const key = objectPath.get(refKey, 'valueFrom.secretKeyRef.key');
      const returnAsBuffer = true;
      secretkey = await this.getSecretData(name, key, namespace, returnAsBuffer);
    }

    const strPassphrase = objectPath.get(authData, 'passphrase');
    const refPassphrase = objectPath.get(authData, 'passphraseRef');
    let passphrase;
    if (strPassphrase) {
      passphrase = Buffer.from(strPassphrase, 'base64').toString();
    } else if (refPassphrase) {
      const name = objectPath.get(refPassphrase, 'valueFrom.secretKeyRef.name');
      const namespace = objectPath.get(refPassphrase, 'valueFrom.secretKeyRef.namespace');
      const key = objectPath.get(refPassphrase, 'valueFrom.secretKeyRef.key');
      passphrase = await this.getSecretData(name, key, namespace);
    }

    return { secretkey, passphrase };
  }
};
