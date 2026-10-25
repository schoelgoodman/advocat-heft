# Setzer und Redaktion als Paket und als OCI-Image (nix2container).
# Der Image-Tag ist der Nix-Hash des Images: ein geändertes Image bekommt einen neuen Tag.
{inputs, ...}: {
  perSystem = {
    pkgs,
    system,
    ...
  }: let
    n2c = inputs.nix2container.packages.${system}.nix2container;
    nodejs = pkgs.nodejs_22;

    # node_modules ohne Dev-Abhängigkeiten plus die gebaute Redaktion unter dist/.
    app = pkgs.buildNpmPackage {
      pname = "advocat-heft";
      version = "0.1.0";
      inherit nodejs;
      src = pkgs.lib.fileset.toSource {
        root = ../..;
        fileset = pkgs.lib.fileset.unions [
          ../../package.json
          ../../package-lock.json
          ../../tsconfig.json
          ../../vite.config.ts
          ../../src
        ];
      };
      # Nach jeder Änderung an package-lock.json neu: prefetch-npm-deps package-lock.json
      npmDepsHash = "sha256-IHLYDVxXQ/pLHjY78IY2qAT3GYtxh+Wbhd6m0mNXes0=";
      npmBuildScript = "editor:build";
      installPhase = ''
        runHook preInstall
        npm prune --omit=dev --no-audit --no-fund
        mkdir -p $out
        cp -r package.json tsconfig.json src dist node_modules $out/
        runHook postInstall
      '';
    };

    # Was der Server zur Laufzeit aufruft: node, git für die Fassungen, Zertifikate für Telegram.
    tools = pkgs.buildEnv {
      name = "advocat-tools";
      paths = with pkgs; [nodejs git cacert coreutils];
      pathsToLink = ["/bin" "/etc"];
    };

    root = pkgs.runCommand "advocat-root" {} ''
      mkdir -p $out/tmp
      ln -s ${app} $out/app
    '';

    image = n2c.buildImage {
      name = "advocat-heft";
      copyToRoot = [tools root];
      # Werkzeuge ändern sich selten; eigene Schicht, getrennt vom Code.
      layers = [(n2c.buildLayer {deps = [tools];})];
      perms = [
        {
          path = root;
          regex = "/tmp";
          mode = "1777";
        }
      ];
      config = {
        Cmd = ["node" "--import" "tsx" "src/server/index.ts"];
        WorkingDir = "/app";
        Env = [
          "PATH=/bin"
          "HOME=/tmp"
          "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
          "NODE_ENV=production"
          "CONTENT_DIR=/content"
          "SITE_DIR=/site"
          "ANFRAGEN_DIR=/anfragen"
          "PORT=4321"
        ];
        ExposedPorts = {"4321/tcp" = {};};
      };
    };
  in {
    packages = {
      advocat-heft = app;
      advocat-heft-image = image;
    };
  };
}
