echo silit
rd /s /q dist
tsc --rootDir . --outDir dist
yarn copy-files
yarn clear-postinstall
yarn compress-dist