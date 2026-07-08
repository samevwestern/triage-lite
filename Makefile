# ==============================================================================
# 🏭 iOS App Factory: Master Orchestration Makefile
# ==============================================================================
# Use this Makefile to dynamically configure, build, and emulate scale-ready 
# multi-tenant iOS applications and Web bundles from a single shared codebase.
#
# Available Apps (defined in apps.json):
#   - triage-lite
#   - bobs-bags
#   - docai-mobile
#   - nexus-workspace
# ==============================================================================

.PHONY: help generate web dev build sim device clean

# Default action
help:
	@echo "🏭 MDEx iOS App Factory - Help Menu"
	@echo "=================================================================="
	@echo "Usage:"
	@echo "  make generate APP=<id>  - Programmatically stamp out branding and config"
	@echo "  make web APP=<id>       - Run local live-reloading Vite dev server"
	@echo "  make build APP=<id>     - Compile production web bundle with dynamic theme"
	@echo "  make sim APP=<id>       - Generate, compile, sync, and launch in iOS Simulator"
	@echo "  make device APP=<id>    - Generate, compile, sync, and open in Xcode ready for signing"
	@echo "  make clean              - Clear distribution and build artifacts"
	@echo "=================================================================="
	@echo "Examples:"
	@echo "  make sim APP=triage-lite"
	@echo "  make sim APP=bobs-bags"
	@echo "  make device APP=docai-mobile"

# 1. Programmatically stamp out target configurations
generate:
	@if [ -z "$(APP)" ]; then \
		echo "❌ Error: Please specify the APP parameter. Example: make generate APP=triage-lite"; \
		exit 1; \
	fi
	@bun run scripts/factory-generate.ts $(APP)

# 2. Run local live-reloading development server
dev: web
web:
	@if [ -z "$(APP)" ]; then \
		echo "⚠️  No APP specified. Booting with currently generated workspace..."; \
	else \
		$(MAKE) generate APP=$(APP); \
	fi
	@bun run dev

# 3. Compile React production web bundles with dynamic styling and assets
build:
	@if [ -n "$(APP)" ]; then \
		$(MAKE) generate APP=$(APP); \
	fi
	@echo "📦 Compiling React application..."
	@bun run build

# 4. Compile, Sync, and Launch directly in a booted iOS Simulator
sim:
	@if [ -z "$(APP)" ]; then \
		echo "❌ Error: Please specify the APP parameter. Example: make sim APP=triage-lite"; \
		exit 1; \
	fi
	@$(MAKE) generate APP=$(APP)
	@$(MAKE) build
	@echo "🔄 Syncing compiled web resources to Capacitor iOS container..."
	@npx cap sync ios
	@echo "📱 Deploying and running on iOS Simulator..."
	@npx cap run ios

# 5. Compile, Sync, and Open native Xcode workspace for local device deployment
device:
	@if [ -z "$(APP)" ]; then \
		echo "❌ Error: Please specify the APP parameter. Example: make device APP=triage-lite"; \
		exit 1; \
	fi
	@$(MAKE) generate APP=$(APP)
	@$(MAKE) build
	@echo "🔄 Syncing compiled web resources to Capacitor iOS container..."
	@npx cap sync ios
	@echo "🛠️ Opening native Xcode workspace..."
	@npx cap open ios

# 6. Clean build and cache outputs
clean:
	@echo "🧹 Cleaning distribution directories..."
	@rm -rf dist
	@echo "✅ Clean complete."
