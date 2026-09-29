# Code signing policy

Lumen releases are currently unsigned. SignPath Foundation enrollment has not been approved or configured. Do not describe a build as signed until its downloaded binaries pass Authenticode verification.

## Proposed maintainer roles

The repository owner, [Doff256](https://github.com/doff256), is the proposed committer, reviewer and release-signing approver. The owner must confirm these roles during enrollment and use multi-factor authentication on GitHub and SignPath. Contributions from other authors require maintainer review before a signing request.

## Privacy

Lumen does not transfer user data to networked systems. Brightness values, display identifiers, presets, schedule coordinates and settings remain on the local computer. The app makes no runtime network requests and has no telemetry or automatic geolocation.

## SignPath Foundation enrollment

[Apply to SignPath Foundation](https://signpath.org/apply.html) using the repository and released Windows binaries. Acceptance is subject to [the Foundation's conditions](https://signpath.org/terms.html), including project reputation, provenance, approved artifacts and manual signing approval; it is not automatic for an MIT-licensed project.

Before enabling signing:

1. The repository owner submits the application and confirms the maintainer roles, MFA and terms. No application has been sent on the owner's behalf.
2. Configure GitHub as a trusted build system and agree the artifact configuration with SignPath. Distinguish Lumen's native helper and portable launcher from third-party Electron binaries; do not claim or re-sign third-party code as Lumen-authored code.
3. Configure the approved organization, project, artifact and signing policy identifiers, plus the scoped signing credential in GitHub Actions secrets. Do not put credentials in source files.
4. Add the [official signing action](https://github.com/SignPath/github-action-submit-signing-request) after artifact upload and before publication. Wait for the maintainer's signing approval, download the signed artifacts and publish those artifacts only. Sign the helper before packing it, then the final portable launcher; configure recursive ZIP handling with SignPath for the ZIP distribution.
5. Verify Authenticode on the downloaded release files, enforce consistent product/version metadata, and fail the release if signing or verification fails. Never silently fall back to unsigned files in a signing-enabled pipeline.
6. Once approved and active, add SignPath's required attribution to this policy and the download page. Until then, retain the explicit unsigned status.

For removal, disable **Start with Windows** in Lumen's tray menu, quit the app, then delete its portable files and (optionally) the local settings folder.
