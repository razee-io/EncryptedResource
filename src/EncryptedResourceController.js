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

const { CompositeController } = require('@razee/razeedeploy-core');


module.exports = class EncryptedResourceController extends CompositeController {
  constructor(params) {
    params.finalizerString = params.finalizerString || 'children.encryptedresource.deploy.razee.io';
    super(params);
  }

  async added() {
    const resources = objectPath.get(this.data, 'object.spec.resources', []);
    resources.forEach((r, i, arr) => arr[i] = Buffer.from(r, 'base64').toString());
    const { privateKey: privateKeyArmored, passphrase } = await this.getDecryptKey(objectPath.get(this.data, 'object.spec.auth', {}));
    const { keys: [privateKey] } = await openpgp.key.readArmored(privateKeyArmored);
    // await privateKey.decrypt(passphrase);
    await Promise.all(resources.map(async r => {
      const { data: decrypted } = await openpgp.decrypt({
        message: await openpgp.message.readArmored(r), // parse armored message
        privateKeys: [privateKey] // for decryption
      });
      console.log(decrypted);
    }));



    // for (var i = 0; i < resources.length; i++) {
    //   let rsp = await this.applyChild(resources[i]);
    //   if (!rsp.statusCode || rsp.statusCode < 200 || rsp.statusCode >= 300) {
    //     this.log.error(rsp);
    //     let kind = objectPath.get(rsp, 'body.details.kind') || objectPath.get(resources, [i, 'kind']);
    //     let group = objectPath.get(rsp, 'body.details.group') || objectPath.get(resources, [i, 'apiVersion']);
    //     let name = objectPath.get(rsp, 'body.details.name') || objectPath.get(resources, [i, 'metadata', 'name']);
    //     return Promise.reject(`${kind}.${group} "${name}" status ${rsp.statusCode} ${objectPath.get(rsp, 'body.reason', '')}.. see logs for details`);
    //   }
    // }
    // await this.reconcileChildren();
  }

  async getDecryptKey(authData) {
    const strKey = objectPath.get(authData, 'privateKey');
    const refKey = objectPath.get(authData, 'privateKeyRef');
    let privateKey;
    if (strKey) {
      privateKey = strKey;
    } else {
      const name = objectPath.get(refKey, 'valueFrom.secretKeyRef.name');
      const namespace = objectPath.get(refKey, 'valueFrom.secretKeyRef.namespace');
      const key = objectPath.get(refKey, 'valueFrom.secretKeyRef.key');
      privateKey = await this.getSecretData(name, key, namespace);
    }

    const strPassphrase = objectPath.get(authData, 'passphrase');
    const refPassphrase = objectPath.get(authData, 'passphraseRef');
    let passphrase;
    if (strPassphrase) {
      passphrase = strPassphrase;
    } else {
      const name = objectPath.get(refPassphrase, 'valueFrom.secretKeyRef.name');
      const namespace = objectPath.get(refPassphrase, 'valueFrom.secretKeyRef.namespace');
      const key = objectPath.get(refPassphrase, 'valueFrom.secretKeyRef.key');
      passphrase = await this.getSecretData(name, key, namespace);
    }

    return { privateKey, passphrase };
  }
};
