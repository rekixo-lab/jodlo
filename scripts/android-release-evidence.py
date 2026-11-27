#!/usr/bin/env python3
"""Inspect unsigned AAB structure and compare reproducible uncompressed payloads.

This never signs/uploads/runs an Android artifact and is not a substitute for
Google Play validation or physical-device acceptance. ZIP timestamps and
compression are excluded from the payload digest; byte SHA-256 is also reported.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
import unittest
import warnings
import zipfile

LIMIT = 512 * 1024 * 1024
REQUIRED = {"BundleConfig.pb", "base/manifest/AndroidManifest.xml", "base/dex/classes.dex", "base/resources.pb"}


def inspect_bundle(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > LIMIT:
        raise ValueError("Expected a bounded regular unsigned AAB file")
    file_hash = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            file_hash.update(chunk)
    digest = hashlib.sha256()
    total = 0
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [info.filename for info in entries]
        if not entries or len(entries) > 10000 or len(set(names)) != len(names):
            raise ValueError("Duplicate, empty or unbounded AAB entries")
        if not REQUIRED.issubset(names):
            raise ValueError("Missing required Android App Bundle payload")
        for info in sorted(entries, key=lambda item: item.filename):
            name = info.filename
            if (name.startswith("/") or "\\" in name or "\x00" in name or
                    ".." in PurePosixPath(name).parts or stat.S_ISLNK(info.external_attr >> 16)):
                raise ValueError("Unsafe archive path")
            if re.match(r"META-INF/.*\.(?:RSA|DSA|EC|SF)$", name, re.IGNORECASE):
                raise ValueError("Release proof must remain unsigned")
            leaf = PurePosixPath(name).name.lower()
            if (leaf.endswith((".pem", ".jks", ".keystore", ".p12")) or
                    leaf in {"google-services.json", ".env", ".dev.vars"} or
                    "service-account" in leaf and leaf.endswith(".json")):
                raise ValueError("Sensitive source/config file embedded in bundle")
            if info.is_dir():
                continue
            if (info.file_size <= 0 and name in REQUIRED) or info.file_size > 128 * 1024 * 1024:
                raise ValueError("Empty required or oversized AAB member")
            total += info.file_size
            if total > LIMIT or info.file_size > max(1, info.compress_size) * 1000:
                raise ValueError("Unbounded decompression budget")
            content_hash = hashlib.sha256()
            actual = 0
            with archive.open(info) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    actual += len(chunk)
                    if actual > info.file_size:
                        raise ValueError("Unexpected uncompressed member size")
                    content_hash.update(chunk)
            if actual != info.file_size:
                raise ValueError("Truncated AAB member")
            digest.update(name.encode("utf-8") + b"\x00" + content_hash.digest())
    return {"kind": "JODLO_UNSIGNED_AAB_EVIDENCE_V1", "fileSha256": file_hash.hexdigest(),
            "payloadSha256": digest.hexdigest(), "entryCount": len(entries), "uncompressedBytes": total,
            "unsignedStructureChecked": True, "releaseAuthorized": False,
            "boundary": "Structure/payload checks only; manifest semantics, owner signing, Play and device acceptance remain separate."}


def compare_bundles(first, second):
    a, b = inspect_bundle(first), inspect_bundle(second)
    if a["payloadSha256"] != b["payloadSha256"]:
        raise ValueError("Unsigned AAB payloads differ between repeated builds")
    return {"kind": "JODLO_REPEATED_AAB_EVIDENCE_V1", "payloadReproducible": True,
            "byteReproducible": a["fileSha256"] == b["fileSha256"], "first": a, "second": b,
            "releaseAuthorized": False}


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="jodlo-aab-test-")
        self.addCleanup(self.tmp.cleanup)

    def bundle(self, name="one.aab", extra=None, date=(2026, 11, 24, 0, 0, 0), missing=None):
        path = Path(self.tmp.name) / name
        with zipfile.ZipFile(path, "w") as z:
            for entry in sorted(REQUIRED - ({missing} if missing else set())):
                z.writestr(zipfile.ZipInfo(entry, date), b"synthetic-test-" + entry.encode())
            for entry, content in (extra or {}).items():
                z.writestr(zipfile.ZipInfo(entry, date), content)
        return path

    def test_structure_reports_no_release_authorization(self):
        proof = inspect_bundle(self.bundle())
        self.assertTrue(proof["unsignedStructureChecked"])
        self.assertFalse(proof["releaseAuthorized"])

    def test_missing_required_members(self):
        for member in REQUIRED:
            with self.assertRaises(ValueError):
                inspect_bundle(self.bundle(missing=member))

    def test_signatures_and_embedded_credentials(self):
        for member in ["META-INF/SIGNER.RSA", "META-INF/SIGNER.SF", "base/assets/key.pem",
                       "base/assets/google-services.json", "base/assets/play-service-account.json"]:
            with self.assertRaises(ValueError):
                inspect_bundle(self.bundle(extra={member: b"fixture"}))

    def test_unsafe_archive_paths(self):
        for member in ["../secret", "/absolute", "base/../secret", "base\\secret"]:
            with self.assertRaises(ValueError):
                inspect_bundle(self.bundle(extra={member: b"fixture"}))

    def test_duplicate_entries(self):
        path = self.bundle()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            with zipfile.ZipFile(path, "a") as z:
                z.writestr("BundleConfig.pb", b"different")
        with self.assertRaises(ValueError):
            inspect_bundle(path)

    def test_timestamp_only_difference_has_same_payload(self):
        first = self.bundle()
        second = self.bundle("two.aab", date=(2026, 11, 25, 0, 0, 0))
        result = compare_bundles(first, second)
        self.assertTrue(result["payloadReproducible"])
        self.assertFalse(result["byteReproducible"])

    def test_actual_payload_difference_fails(self):
        first = self.bundle()
        second = self.bundle("two.aab", extra={"base/assets/added.txt": b"different"})
        with self.assertRaises(ValueError):
            compare_bundles(first, second)


def main():
    if sys.argv[1:] == ["--self-test"]:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(BundleTests)
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    parser = argparse.ArgumentParser(description=__doc__)
    options = parser.add_mutually_exclusive_group(required=True)
    options.add_argument("--inspect", metavar="AAB")
    options.add_argument("--compare", nargs=2, metavar=("FIRST_AAB", "SECOND_AAB"))
    args = parser.parse_args()
    try:
        result = inspect_bundle(args.inspect) if args.inspect else compare_bundles(*args.compare)
    except (OSError, ValueError, zipfile.BadZipFile, RuntimeError):
        print("Unsigned Android bundle evidence failed validation; no signing or upload occurred.", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
