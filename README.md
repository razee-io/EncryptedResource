# EncryptedResource

[![Build Status](https://travis-ci.com/razee-io/EncryptedResource.svg?branch=master)](https://travis-ci.com/razee-io/EncryptedResource)
![GitHub](https://img.shields.io/github/license/razee-io/EncryptedResource.svg?color=success)
[![Dependabot Status](https://api.dependabot.com/badges/status?host=github&repo=razee-io/EncryptedResource)](https://dependabot.com)

Razeedeploy: component to transport and decrypt secret Kubernetes resources. Currently
supports PGP keys and encrypted resources.

## Install

```shell
kubectl apply -f "https://github.com/razee-io/EncryptedResource/releases/latest/download/resource.yaml"
```

## Resource Definition

### Sample

```yaml
apiVersion: "deploy.razee.io/v1alpha2"
kind: EncryptedResource
metadata:
  name: <name>
  namespace: <namespace>
spec:
  resources: # must be base64 encoded
    - <encrypted-base64_encoded-resource>
  auth:
    privateKeyRef:
      valueFrom:
        secretKeyRef:
          name: <secret_name>
          namespace: <secret_namespace>
          key: <secret_key>
    passphraseRef: # optional
      valueFrom:
        secretKeyRef:
          name: <secret_name>
          namespace: <secret_namespace>
          key: <secret_key>
```

### Spec

**Path:** `.spec`

**Description:** `spec` is required and **must** include sections `resources`
and `auth`.

**Schema:**

```yaml
spec:
  type: object
  required: [resources, auth]
  properties:
    resources:
      type: array
      ...
    auth:
      type: object
      ...
```

### Resources

**Path:** `.spec.resources[]`

**Description:** Resources to be decrypted and applied to the cluster. There must
be at least one resource in the list.

**Note:** All resources must be base64 encoded, whether they are ascii armored
or not.

**Schema:**

```yaml
resources:
  type: array
  minItems: 1
  items:
    type: string
```

### Authentication

**Path:** `.spec.auth`

**Description:** Authentication to be able to decrypt the resources. Auth must
include a private key, but optionally can also include a passphrase that the private
key is encrypted with. You may specify the key/passphrase as a secret reference
or hardcoded as a string (hardcoded strings are not recommended, but added to
assist in development and testing).

**Note:** If using hardcoded strings, they must be base64 encoded, whether they
are ascii armored or not.

**Schema:**

```yaml
auth:
  type: object
  oneOf:
    - required: [privateKey]
    - required: [privateKeyRef]
  properties:
    privateKey:
      type: string
    privateKeyRef:
      type: object
      required: [valueFrom]
      ...
    passphrase:
      type: string
    passphraseRef:
      type: object
      required: [valueFrom]
      ...
```

### Managed Resource Labels

#### Reconcile

Child resource: `.metadata.labels[deploy.razee.io/Reconcile]`

- DEFAULT: `true`
  - A razeedeploy resource (parent) will clean up a resources it applies (child)
when either the child is no longer in the parent resource definition or the
parent is deleted.
- `false`
  - This behavior can be overridden when a child's resource definition has
the label `deploy.razee.io/Reconcile=false`.

#### Resource Update Mode

Child resource: `.metadata.labels[deploy.razee.io/mode]`

Razeedeploy resources default to merge patching children. This behavior can be
overridden when a child's resource definition has the label
`deploy.razee.io/mode=<mode>`

Mode options:

- DEFAULT: `MergePatch`
  - A simple merge, that will merge objects and replace arrays. Items previously
  defined, then removed from the definition, will be removed from the live resource.
  - "As defined in [RFC7386](https://tools.ietf.org/html/rfc7386), a Merge Patch
  is essentially a partial representation of the resource. The submitted JSON is
  "merged" with the current resource to create a new one, then the new one is
  saved. For more details on how to use Merge Patch, see the RFC." [Reference](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md#patch-operations)
- `StrategicMergePatch`
  - A more complicated merge, the kubernetes apiServer has defined keys to be
  able to intelligently merge arrays it knows about.
  - "Strategic Merge Patch is a custom implementation of Merge Patch. For a
  detailed explanation of how it works and why it needed to be introduced, see
  [StrategicMergePatch](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-api-machinery/strategic-merge-patch.md)."
  [Reference](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md#patch-operations)
  - [Kubectl Apply Semantics](https://kubectl.docs.kubernetes.io/pages/app_management/field_merge_semantics.html)
- `EnsureExists`
  - Will ensure the resource is created and is replaced if deleted. Will not
  enforce a definition.

### Debug Individual Resource

`.spec.resources.metadata.labels[deploy.razee.io/debug]`

Treats the live resource as EnsureExist. If any razeedeploy component is enforcing
the resource, and the label `deploy.razee.io/debug: true` exists on the live
resource, it will treat the resource as ensure exist and not override any changes.
This is useful for when you need to debug a live resource and don't want razeedeploy
overriding your changes. Note: this will only work when you add it to live resources.
If you want to have the EnsureExist behavior, see [Resource Update Mode](#Resource-Update-Mode).

- ie: `kubectl label rr <your-rr> deploy.razee.io/debug=true`

### Lock Cluster Updates

Prevents the controller from updating resources on the cluster. If this is the
first time creating the `razeedeploy-config` ConfigMap, you must delete the running
controller pods so the deployment can mount the ConfigMap as a volume. If the
`razeedeploy-config` ConfigMap already exists, just add the pair `lock-cluster: true`.

1. `export CONTROLLER_NAME=encryptedresource-controller && export CONTROLLER_NAMESPACE=razee`
1. `kubectl create cm razeedeploy-config -n $CONTROLLER_NAMESPACE --from-literal=lock-cluster=true`
1. `kubectl delete pods -n $CONTROLLER_NAMESPACE $(kubectl get pods -n $CONTROLLER_NAMESPACE
 | grep $CONTROLLER_NAME | awk '{print $1}' | paste -s -d ',' -)`
