# PiWeb Native Defense Binaries

Platform-specific precompiled defense modules. **No source included** — these are closed binaries.

## Selection

| Target | Directory | Files |
|--------|-----------|-------|
| Linux ARM64 (Raspberry Pi 4/5, ARM servers) |  | counterattack, tracker |
| Windows x64                                  |       | counterattack.exe, tracker.exe |

## Deployment

Copy the appropriate file(s) to the PiWeb root directory (same level as ). Mark the Linux binaries executable:



## Integrity

Linux ELFs are ARM64 (aarch64), dynamically linked against glibc 2.31+ (compatible with Raspberry Pi OS Bookworm/Trixie). Not stripped.

Windows executables are x64 (AMD64).
