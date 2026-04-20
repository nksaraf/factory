git add .
git commit -am "deploy"
git push --no-verify
ssh factory-prod "cd /home/lepton/workspace/factory && git pull && docker compose build infra-factory && docker compose up -d infra-factory"