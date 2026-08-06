/**
 * A throwaway RSA pair the e2e suites sign and verify test tokens with.
 *
 * It lives here, in one place, because two sides need *the same* pair: the
 * `mock` composition root is configured to verify with the public half, and the
 * spec helpers sign with the private half. Generating one per file would make
 * every token the other side cannot verify.
 *
 * Deliberately **not** the development pair config-service seeds. A suite that
 * happened to verify a real dev token would be passing for the wrong reason,
 * and a fixture that doubles as a live credential is one copy-paste away from
 * becoming one.
 */
export const E2E_KEY_ID = 'e2e-key';

export const E2E_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCOQ+cUUN5cVpHo
wv8SRQYNzGLS6jrEXxzCRggsKvwZS6aa13lJpneB4M5m1K+SXK5aedOeSOl/FyQM
cLzK/xSMF/CIscZWt5mRFQO75bKyNysUWk2WFUT0e4IZkaAypJdN1pK75XF6OaCI
vjrP8OuBfDQ61STTzlekLyMA+ZNzwUBR29LhB1Zuh1COocLyyXYry8Tg97njZHSp
WnmtfKg3WVgHpHLcYiQDUnD0nmjhuJXor/1samgb87k+yxXMuJWTu++sxESQMmpV
i1iJ4zPQn7IzS799pEn/zFJgRGyIowka3f2DOY8u7O/5JDn5XCI/Qcq4rq9ky1Qa
H901dkXPAgMBAAECggEAA26GHOp0srLbAxLRGMgrPakUfoZsXkL1+qKd1hLqe6jW
LVbpuvgyWrEFkLEBmzXJIK9ev3JFelEgle4ECoNPXOjf0IGniWDcaiIvMcNb0Cbz
pGmZPYYE7um4PM2otWVcyeGqvOkkbPQieBu+oFSX4NkSJ7BEjHzCox9BvcryF59d
c9oFzS97YryD8g94qH6SqgF90qxnxD5oSqz3yRuON6o6SiBwSdsT5yCTiiBIsBSb
yZP7KN/4LPZnFaPcHJ6UtlMOPae47Z7UBdiuP8/isSyIbnU7j1+TrpXUBqqG6JFI
EJx3rRW4yYy/syt8BkkLnKa9idbZfCgii+C/X6FNgQKBgQDAd00/+ZIp5HwRkJ7M
e4SSPxEW9kdCdNwCG9D6GvWZO9d/eeidnM+eoTRPx9NdvfiP5ztsZEtDDfXzMQFp
Jd7Loq5Nc3ZQBchPOIoFGIruUVWlUVawgneRKggfRzDEJLlKBjbVNsPPJFEPkMyO
XShRKR0cnY4pNen6ug6YRQn7kQKBgQC9OkqCeqVftgi5gE0VkBRf1i1bRIIClw9z
K08XYej54JcMdYqlTdpsRK0QQYye+wVH3V0Oe2p40leDeVbQMx4W4C1/Rl+Hk05r
QF9yvgIBPccE/D63ufcKdagj1QLHDXIHUhoMVqtaZIodBSenAV0uOtPKS+6vlVH6
OlM+Zo+7XwKBgQCOAbiCwn7g4A/W2fEBCQXY7iWK3q3XT+fgumtnjiq2JBwtl2JV
oJTkAydY0iSXHwreCouivyF02UEmbXsP/Pw1HdQjm1SpWIriQOI9Pk2L54Ec2DXx
SGI2Pl/9zAYkQsBf6NPeX2j8Vlxk8r6rL/sGXyJ2sZ1ptLjt4QfRu+bQsQKBgQCy
iHHOQ3sOH4iBxIx2ALdIaKHoj21+lhnMlpsLu6P9RiodZjUGm7quFemXAdF0GfA0
iqWGyWh+UC6ja/M9gk0sVhx3DeWJ27DMPjMP5jesBiZlDLz7yWhMpQ+bpxj0xznD
sHHFHGyVX3Bzyu5LglzxBi3Wmue7H831odvybv/DTwKBgETuVvv5b2EhMbKahtnf
dNrT9ZivoiRD4OaZBXffTG0I2HMu20a7nthKbv2o4pxztDcpW8s6UMU87N8YAK4W
GX3DjBMHIELxRE96tjifpW9MGQijLCI+jteq4lX0Pxf6HiUB+T1jZ1KDQQfvWJpH
cAvNvxF+Tev5A4GaIKwmahLI
-----END PRIVATE KEY-----
`;

export const E2E_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjkPnFFDeXFaR6ML/EkUG
Dcxi0uo6xF8cwkYILCr8GUummtd5SaZ3geDOZtSvklyuWnnTnkjpfxckDHC8yv8U
jBfwiLHGVreZkRUDu+WysjcrFFpNlhVE9HuCGZGgMqSXTdaSu+VxejmgiL46z/Dr
gXw0OtUk085XpC8jAPmTc8FAUdvS4QdWbodQjqHC8sl2K8vE4Pe542R0qVp5rXyo
N1lYB6Ry3GIkA1Jw9J5o4biV6K/9bGpoG/O5PssVzLiVk7vvrMREkDJqVYtYieMz
0J+yM0u/faRJ/8xSYERsiKMJGt39gzmPLuzv+SQ5+VwiP0HKuK6vZMtUGh/dNXZF
zwIDAQAB
-----END PUBLIC KEY-----
`;

/**
 * A key nothing in the fleet trusts, for the suites that assert a forged token
 * is refused.
 *
 * A separate pair rather than a mangled signature, because they fail for
 * different reasons: a corrupt signature could plausibly be caught by a
 * structural check, while a *validly signed token from the wrong issuer's key*
 * is the actual attack, and only a real verification catches it.
 */
export const E2E_FOREIGN_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCgkVvRRzabj1gS
Zylt4+H7vMIL/nlCC/WoCLegBia3b9RaOkfCdXi+N99oFkcwwjywRsXmotNyPhEi
rqFEvvxUCZQmk9Cdo2+DYzFZq/6k2/5+e3Tr3NDlvYHVaqp6CRC+DqMIorQ6TT3D
SV/pu/Gz1U1MgE9TeB/Zw5yUjenknyjWzxeRwJjKvn10Jg2/YJzcvcsKeiED6+LU
FVkiJsvnxUvuJWnjGmtXocb85PbN4oD54eERLGL/cxZB4p8K6P/KTQrQV207qL+m
RqYjTj2Wu/ct4FSdGPKm5mhMP87sqioXU14t2R/nltIgiom0FajqyrR15krLkXSy
0PrGIqbHAgMBAAECggEAT1aTrkxIRMQm6ez0cRqFOoyRuzhxtPtQ1kb8aIMxlTka
Db03YPQHhcH4zycW5RZMw3Ms7SGuZggaEm+EOwI9js6u2AL4tTOg8aRNKbhNGiuj
y953ruWMiMBDS28priQVlDuKPkWa1SX+aySx0j2uF8RBLhhGWgGEh2ba0yJuHCrq
N+l7wU26loDjlwS7dTQYc8z2WvGnKBbJVUJzJaLeUyMftVCd86sgjiYX9nnVuqxo
T9kE7/GhLOeP1vSjYj3Tk6CrQQlEanIUrSrogMt0LXVtek5sDyFPqTKnhd+bjNtl
sTfibYU7Yq4xlV/Bu3ntJYXh0hiL4VS1bOWc1rh6oQKBgQDLtiMbPuREXwJwgYKP
SB72RhGiT1fvklWyq43CGMsVgE43ncJAtrGb6A0fBVspYnS7YKIaUAVTyboNrycD
JzgFaVF/m75GeQDKOoRoPRfke/ytA3NIEeAy2Vo+1ZD60SLVdvFgusuJbwrg0Vn7
oxbigMi39Bif5ADz/+nupDgoJwKBgQDJyEFLq0CSiltScR7GzkCM9rSNs2ntSNOL
GVM7iZ32AP+UukFa02CC/s+6p660JUtFuZ6ax8npb+TAwWc2BydcRuqMQVmDMZ0j
l1A/PNZS9myvgy+RpwCtWPJc0k2AIrMIJM6pcj/ZByxV1tJcKj19CyM03phlg9Py
TtmkSX8QYQKBgQCnyDoeBKzJy18c/u5jyMkHmiqH/sW0olhHMpktVnJeITFLCXqn
BlI+0N+Nv0GYUmlGs46QEXxxyGKfRrXhGPpBKr9fVQ1gyeTmq0/G8xqsq5ovffoD
UAXSm8aCnjAtBPelzbN9MhzV80mIZaWxZmBA6kVnjXqCpq5KSWuJjGRcXQKBgBLe
4IRkGqDZwZqfK6KqDU1hkRcjbUecpPQARVFvGE+2XjCZjp0g4Yi+rcyl++erCTQX
HOcawh5LsZf5Pl7GIn81vp+pSObFEA4RC5cuaFjP5PAxE5TKinyrsdbOcCMIm7eq
QY2FOsVgL1xDv96QsLlt/jfmjVgJERw7FY2QtgphAoGAcbrPfjRrDMqthf3LJsFu
ZH3hkadfbsCLld6UvAva0Vkugv5kOx0wB6+Bbk3rEGUPUxpaq1+iFhr7gUlghAA3
lRKwXGJZJc5PIUuHoxCYg/W4rKbYlrlYAwYQaNIucTT/bUgXw6Ra5rxEqnpgKiqJ
MUzrkxXjBuapqxOF4QzIySg=
-----END PRIVATE KEY-----
`;
