{
  "message": "internal error; reference = 1vtcj2vfcr284rqdd9iec1rl",
  "exception": {
    "name": "Error",
    "message": "internal error; reference = 1vtcj2vfcr284rqdd9iec1rl",
    "timestamp": 1765461623113
  },
  "$workers": {
    "truncated": false,
    "event": {
      "request": {
        "url": "https://api.spoke.so/ws",
        "method": "GET",
        "path": "/ws"
      }
    },
    "outcome": "loadShed",
    "scriptName": "spoke-api",
    "eventType": "fetch",
    "executionModel": "stateless",
    "scriptVersion": {
      "id": "17be4240-bf14-4b98-b95c-393c9ef32631"
    },
    "requestId": "9ac57ea88a138229"
  },
  "$metadata": {
    "id": "01KC6VD0A9S336CK3HZG22E3KW",
    "requestId": "9ac57ea88a138229",
    "trigger": "GET /ws",
    "service": "spoke-api",
    "level": "error",
    "error": "internal error; reference = 1vtcj2vfcr284rqdd9iec1rl",
    "message": "internal error; reference = 1vtcj2vfcr284rqdd9iec1rl",
    "account": "b738f434807b8a6fe9031a75c71d4393",
    "type": "cf-worker",
    "fingerprint": "3cfea74df62e5ce80d360721126a5b82",
    "origin": "fetch",
    "messageTemplate": "internal error; reference = <*>"
  }
},
{
  "level": "error",
  "message": "GET https://api.spoke.so/ws",
  "$workers": {
    "event": {
      "request": {
        "cf": {
          "requestHeaderNames": {},
          "isEUCountry": false,
          "httpProtocol": "HTTP/1.1",
          "tlsCipher": "AEAD-AES128-GCM-SHA256",
          "continent": "AS",
          "clientAcceptEncoding": "gzip, deflate, br",
          "verifiedBotCategory": "",
          "country": "IN",
          "region": "Telangana",
          "tlsClientCiphersSha1": "pdGcErBTDt22TM3jTvj6A2k54tY=",
          "tlsClientAuth": {
            "certIssuerDNLegacy": "",
            "certIssuerSKI": "",
            "certSubjectDNRFC2253": "",
            "certSubjectDNLegacy": "",
            "certFingerprintSHA256": "",
            "certNotBefore": "",
            "certSKI": "",
            "certSerial": "",
            "certIssuerDN": "",
            "certVerified": "NONE",
            "certNotAfter": "",
            "certSubjectDN": "",
            "certPresented": "0",
            "certRevoked": "0",
            "certIssuerSerial": "",
            "certIssuerDNRFC2253": "",
            "certFingerprintSHA1": ""
          },
          "tlsClientRandom": "XwUQJFwa6gtZCyzVmuzKoYROKAWyr6lTzcASeSd7wyI=",
          "tlsExportedAuthenticator": {
            "clientFinished": "431cff162bf4579903fc5edec78ed82537510756bc2c1e359bfba47d83968d7c",
            "clientHandshake": "eb8622ecb421503bf394836ce9fd17d148ba314c7b209162269dcc0b561dcd45",
            "serverHandshake": "a8ec30ec47348d068149867824b298f585181f5bed85d082a90354ac3b156253",
            "serverFinished": "05c3f5a22889fe8307097b4d2ae52d8a2560b0f097b1950985b4208760da3a7b"
          },
          "tlsClientHelloLength": "2004",
          "colo": "SIN",
          "timezone": "Asia/Kolkata",
          "longitude": "78.54263",
          "latitude": "17.50427",
          "requestPriority": "",
          "postalCode": "500070",
          "city": "Secunderabad",
          "tlsVersion": "TLSv1.3",
          "regionCode": "TG",
          "asOrganization": "Reliance Jio Infocomm Limited",
          "tlsClientExtensionsSha1Le": "YxJ7nvyg3Wr3gOKmGN9kJZvqBxM=",
          "tlsClientExtensionsSha1": "FidYfKiBGWSRlpv5wRce63oZjxI=",
          "clientTcpRtt": 63,
          "asn": 55836,
          "edgeRequestKeepAliveStatus": 1
        },
        "url": "https://api.spoke.so/ws",
        "method": "GET",
        "headers": {
          "accept-encoding": "gzip, br",
          "accept-language": "en-US",
          "cache-control": "no-cache",
          "cf-connecting-ip": "2405:201:c012:5128:fd44:2b94:8303:e0c9",
          "cf-ipcountry": "IN",
          "cf-ray": "9ac57ea88a138229",
          "cf-visitor": "{\"scheme\":\"https\"}",
          "connection": "Upgrade",
          "host": "api.spoke.so",
          "origin": "file://",
          "pragma": "no-cache",
          "sec-websocket-extensions": "permessage-deflate; client_max_window_bits",
          "sec-websocket-key": "REDACTED",
          "sec-websocket-version": "13",
          "upgrade": "websocket",
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Spoke/0.4.3 Chrome/134.0.6998.44 Electron/35.0.1 Safari/537.36",
          "x-forwarded-proto": "https",
          "x-real-ip": "2405:201:c012:5128:fd44:2b94:8303:e0c9"
        },
        "path": "/ws"
      },
      "rayId": "9ac57ea88a138229"
    },
    "diagnosticsChannelEvents": [],
    "truncated": false,
    "scriptName": "spoke-api",
    "outcome": "loadShed",
    "eventType": "fetch",
    "executionModel": "stateless",
    "scriptVersion": {
      "id": "17be4240-bf14-4b98-b95c-393c9ef32631"
    },
    "requestId": "9ac57ea88a138229",
    "cpuTimeMs": 37,
    "wallTimeMs": 138199
  },
  "$metadata": {
    "id": "01KC6VCYG12M1NZFZQ013JC7QG",
    "requestId": "9ac57ea88a138229",
    "trigger": "GET /ws",
    "service": "spoke-api",
    "level": "error",
    "error": "GET https://api.spoke.so/ws",
    "message": "GET https://api.spoke.so/ws",
    "account": "b738f434807b8a6fe9031a75c71d4393",
    "type": "cf-worker-event",
    "fingerprint": "3994197952d6cffdaf42c6956be7f55e",
    "origin": "fetch",
    "messageTemplate": "GET https://api.spoke.so/ws"
  }
},
{
  "message": "internal error; reference = fhbv745sibv8ufn6vhgn0ehq",
  "exception": {
    "name": "Error",
    "message": "internal error; reference = fhbv745sibv8ufn6vhgn0ehq",
    "timestamp": 1765461623113
  },
  "$workers": {
    "truncated": false,
    "event": {
      "request": {
        "url": "https://api.spoke.so/ws",
        "method": "GET",
        "path": "/ws"
      }
    },
    "outcome": "loadShed",
    "scriptName": "spoke-api",
    "eventType": "fetch",
    "executionModel": "stateless",
    "scriptVersion": {
      "id": "17be4240-bf14-4b98-b95c-393c9ef32631"
    },
    "requestId": "9ac57ea88a138229"
  },
  "$metadata": {
    "id": "01KC6VD0A9S336CK3HZG22E3KX",
    "requestId": "9ac57ea88a138229",
    "trigger": "GET /ws",
    "service": "spoke-api",
    "level": "error",
    "error": "internal error; reference = fhbv745sibv8ufn6vhgn0ehq",
    "message": "internal error; reference = fhbv745sibv8ufn6vhgn0ehq",
    "account": "b738f434807b8a6fe9031a75c71d4393",
    "type": "cf-worker",
    "fingerprint": "f0234efc7d4fa9701b72f32db50013e4",
    "origin": "fetch",
    "messageTemplate": "internal error; reference = <*>"
  }
},
{
  "message": "internal error; reference = gdr4b56olqbq8tq6co3d7ud4",
  "exception": {
    "name": "Error",
    "message": "internal error; reference = gdr4b56olqbq8tq6co3d7ud4",
    "timestamp": 1765461623113
  },
  "$workers": {
    "truncated": false,
    "event": {
      "request": {
        "url": "https://api.spoke.so/ws",
        "method": "GET",
        "path": "/ws"
      }
    },
    "outcome": "loadShed",
    "scriptName": "spoke-api",
    "eventType": "fetch",
    "executionModel": "stateless",
    "scriptVersion": {
      "id": "17be4240-bf14-4b98-b95c-393c9ef32631"
    },
    "requestId": "9ac57ea88a138229"
  },
  "$metadata": {
    "id": "01KC6VD0A9S336CK3HZG22E3KY",
    "requestId": "9ac57ea88a138229",
    "trigger": "GET /ws",
    "service": "spoke-api",
    "level": "error",
    "error": "internal error; reference = gdr4b56olqbq8tq6co3d7ud4",
    "message": "internal error; reference = gdr4b56olqbq8tq6co3d7ud4",
    "account": "b738f434807b8a6fe9031a75c71d4393",
    "type": "cf-worker",
    "fingerprint": "1479493c1e5df32c9e366a289913d69c",
    "origin": "fetch",
    "messageTemplate": "internal error; reference = <*>"
  }
},
{
  "level": "error",
  "message": "[Auth] JWT verification failed:",
  "error": "request timed out",
  "name": "JWKSTimeout",
  "$workers": {
    "truncated": false,
    "event": {
      "request": {
        "url": "https://api.spoke.so/ws",
        "method": "GET",
        "path": "/ws"
      }
    },
    "outcome": "ok",
    "scriptName": "spoke-api",
    "eventType": "fetch",
    "executionModel": "stateless",
    "scriptVersion": {
      "id": "4e4785d6-7e5a-4ada-8b20-b0cc3b4cd2f0"
    },
    "requestId": "9ac5a2b35e82895e"
  },
  "$metadata": {
    "id": "01KC6WP00CN2X4ASKE2J17BP1C",
    "requestId": "9ac5a2b35e82895e",
    "trigger": "GET /ws",
    "service": "spoke-api",
    "level": "error",
    "error": "[Auth] JWT verification failed:",
    "message": "[Auth] JWT verification failed:",
    "account": "b738f434807b8a6fe9031a75c71d4393",
    "type": "cf-worker",
    "fingerprint": "0cd9a5aed1b61c954f96154b3ba20b33",
    "origin": "fetch",
    "messageTemplate": "[Auth] JWT verification failed:"
  }
},
{
  "level": "error",
  "msg": "[WS] socket error",
  "ip": "2405:201:c012:5128:fd44:2b94:8303:e0c9",
  "error": "[object ErrorEvent]",
  "ts": 1765462428193,
  "$workers": {
    "truncated": false,
    "event": {
      "request": {
        "url": "https://api.spoke.so/ws",
        "method": "GET",
        "path": "/ws"
      }
    },
    "outcome": "ok",
    "scriptName": "spoke-api",
    "eventType": "fetch",
    "executionModel": "stateless",
    "scriptVersion": {
      "id": "17be4240-bf14-4b98-b95c-393c9ef32631"
    },
    "requestId": "9ac5953d4d936cc1"
  },
  "$metadata": {
    "id": "01KC6W5JH10E4C4VZ8T6Z37D9B",
    "requestId": "9ac5953d4d936cc1",
    "trigger": "GET /ws",
    "service": "spoke-api",
    "level": "error",
    "error": "[WS] socket error",
    "message": "[WS] socket error",
    "account": "b738f434807b8a6fe9031a75c71d4393",
    "type": "cf-worker",
    "fingerprint": "63de5a88d909295a190e7d86875e7c53",
    "origin": "fetch",
    "messageTemplate": "[WS] socket error"
  }
},
{
  "message": "The Workers runtime canceled this request because it detected that your Worker's code had hung and would never generate a response. Refer to: https://developers.cloudflare.com/workers/observability/errors/",
  "exception": {
    "name": "Error",
    "message": "The Workers runtime canceled this request because it detected that your Worker's code had hung and would never generate a response. Refer to: https://developers.cloudflare.com/workers/observability/errors/",
    "timestamp": 1765462969644
  },
  "$workers": {
    "truncated": false,
    "event": {
      "request": {
        "url": "https://api.spoke.so/ws",
        "method": "GET",
        "path": "/ws"
      }
    },
    "outcome": "exception",
    "scriptName": "spoke-api",
    "eventType": "fetch",
    "executionModel": "stateless",
    "scriptVersion": {
      "id": "4e4785d6-7e5a-4ada-8b20-b0cc3b4cd2f0"
    },
    "requestId": "9ac5a2c12d8b9d23"
  },
  "$metadata": {
    "id": "01KC6WP39C3W5DPKS3305Y83E8",
    "requestId": "9ac5a2c12d8b9d23",
    "trigger": "GET /ws",
    "service": "spoke-api",
    "level": "error",
    "error": "The Workers runtime canceled this request because it detected that your Worker's code had hung and would never generate a response. Refer to: https://developers.cloudflare.com/workers/observability/errors/",
    "message": "The Workers runtime canceled this request because it detected that your Worker's code had hung and would never generate a response. Refer to: https://developers.cloudflare.com/workers/observability/errors/",
    "account": "b738f434807b8a6fe9031a75c71d4393",
    "type": "cf-worker",
    "fingerprint": "87f9d679805d345d2022ec6b720875bc",
    "origin": "fetch",
    "messageTemplate": "The Workers runtime canceled this request because it detected that your Worker's code had hung and would never generate a response. Refer to: https://developers.cloudflare.com/workers/observability/errors/"
  }
}