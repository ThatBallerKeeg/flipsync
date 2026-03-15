#!/usr/bin/env python3
"""
Depop API proxy using curl_cffi to bypass Cloudflare TLS fingerprinting.

JSON request:
  python3 fetch.py <method> <url> <token> [json_body]

Multipart file upload (method must be POST):
  python3 fetch.py UPLOAD <url> <token> <filepath>

Prints response as: <status_code>\n<response_body>
"""
import sys
import json
import os
from curl_cffi import requests, CurlMime

HEADERS_BASE = {
    "Authorization": "",  # filled below
    "Accept": "application/json",
    "User-Agent": "Depop/2.383.0 (iPhone; iOS 17.4; Scale/3.00)",
    "Accept-Language": "en-US,en;q=0.9",
    "X-Depop-App-Version": "2.383.0",
    "X-Depop-Platform": "ios",
    "X-Depop-Currency": "USD",
}

def main():
    if len(sys.argv) < 4:
        print("400")
        print(json.dumps({"error": "Too few arguments"}))
        sys.exit(1)

    method = sys.argv[1].upper()
    url = sys.argv[2]
    token = sys.argv[3]

    headers = {**HEADERS_BASE, "Authorization": f"Bearer {token}"}

    try:
        if method == "UPLOAD":
            # Multipart photo upload — argv[4] is local file path
            filepath = sys.argv[4]
            with open(filepath, "rb") as f:
                img_bytes = f.read()
            fname = os.path.basename(filepath)
            # curl_cffi v0.13+ requires CurlMime for multipart uploads
            mf = CurlMime()
            mf.addpart(name="file", data=img_bytes, filename=fname, content_type="image/jpeg")
            response = requests.post(
                url,
                headers=headers,
                multipart=mf,
                impersonate="safari15_5",
                timeout=60,
            )
        else:
            # Regular JSON request
            kwargs = {
                "headers": {**headers, "Content-Type": "application/json"},
                "impersonate": "safari15_5",
                "timeout": 30,
            }
            body = sys.argv[4] if len(sys.argv) > 4 else None
            if body:
                kwargs["data"] = body
            response = getattr(requests, method.lower())(url, **kwargs)

        print(response.status_code)
        print(response.text)
    except Exception as e:
        print("500")
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
