SHELL := /bin/bash
.PHONY: help setup dev build package publish publish-dry clean clean-dist preview lint test test-e2e test-e2e-ui test-e2e-headed test-e2e-install check-version update-deps install-dev image-build image-run image-stop image-clean

# Per-developer overrides (container runner, image name, port). Optional: the
# leading `-` means it's fine if the file is absent. Defaults below apply when a
# value isn't set, so `image-*` works out of the box. Copy or edit .makefile.env
# to switch the runner (e.g. DOCKER_RUNNER = docker).
-include .makefile.env
DOCKER_RUNNER  ?= podman
IMAGE_NAME     ?= registry.km8.es/web-treeview-examples:prod
CONTAINER_NAME ?= web-treeview-examples
IMAGE_PORT     ?= 12210

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

setup: ## Install dependencies and prepare project
	@echo "Installing dependencies..."
	npm install
	@echo "Setup complete"

dev: ## Start development server with hot reload
	@echo "Starting development server..."
	npm run dev

build: ## Build for production
	@echo "Building for production..."
	npm run build
	@echo "Build complete - Files in ./dist"

package: build ## Create npm package (tarball)
	@echo "Creating package..."
	npm pack
	@echo "Package created - see above for details"

publish-dry: ## Publish to npm (dry run) (TAG=rc for pre-release)
	@echo "Running publish dry-run..."
	npm publish --dry-run $(if $(TAG),--tag $(TAG))
	@echo "Dry-run complete - Review the output above"

publish: ## Publish to npm (TAG=rc for pre-release)
	@echo "WARNING: This will publish to npm registry"
	@echo "Press Ctrl+C to cancel, or Enter to continue..."
	@powershell -Command "Read-Host | Out-Null"
	@echo "Publishing to npm..."
	npm publish $(if $(TAG),--tag $(TAG))
	@echo "Published successfully"

clean: ## Clean build artifacts and node_modules
	@echo "Cleaning build artifacts..."
	npm run clean
	@echo "Clean complete"

clean-dist: ## Clean only dist folder
	@echo "Cleaning dist folder..."
	npm run clean:dist
	@echo "Dist cleaned"

preview: build ## Preview production build
	@echo "Starting preview server..."
	npm run preview

lint: ## Run linter (if configured)
	@echo "Linting is not configured yet"
	@echo "Consider adding ESLint in the future"

test: test-e2e ## Run all tests (alias for test-e2e)

test-e2e: ## Run Playwright e2e tests (headless)
	npm run test:e2e

test-e2e-ui: ## Open Playwright Test UI for debugging
	npm run test:e2e:ui

test-e2e-headed: ## Run Playwright e2e tests with visible browser
	npm run test:e2e:headed

test-e2e-install: ## Download Chromium browser binary (one-time setup)
	npm run test:e2e:install

check-version: ## Show current package version
	@echo "Current version:"
	@node -p "require('./package.json').version"

update-deps: ## Update dependencies
	@echo "Updating dependencies..."
	npm update
	@echo "Dependencies updated"

install-dev: ## Install as local dev dependency (for testing)
	@echo "Installing package locally..."
	npm pack
	@echo "You can now install this in another project with:"
	@echo "npm install <path-to-tgz-file>"

# ── Container image (examples site) ──────────────────────────────────────────
# Runner is configurable via .makefile.env (DOCKER_RUNNER); defaults to podman.

image-build: ## Build the examples container image (build + serve stages)
	@echo "Building $(IMAGE_NAME) with $(DOCKER_RUNNER)..."
	$(DOCKER_RUNNER) build -t $(IMAGE_NAME) .
	@echo "Image built: $(IMAGE_NAME)"

image-run: ## Run the examples image (serves on IMAGE_PORT, default 12210)
	@echo "Starting $(CONTAINER_NAME) on http://localhost:$(IMAGE_PORT) ..."
	-@$(DOCKER_RUNNER) rm -f $(CONTAINER_NAME) >/dev/null 2>&1
	$(DOCKER_RUNNER) run -d --name $(CONTAINER_NAME) -p $(IMAGE_PORT):80 $(IMAGE_NAME)
	@echo "Serving examples at http://localhost:$(IMAGE_PORT)"

image-stop: ## Stop and remove the examples container
	@echo "Stopping $(CONTAINER_NAME)..."
	-@$(DOCKER_RUNNER) rm -f $(CONTAINER_NAME) >/dev/null 2>&1
	@echo "Stopped"

image-clean: image-stop ## Remove the examples container and image
	@echo "Removing image $(IMAGE_NAME)..."
	-@$(DOCKER_RUNNER) rmi $(IMAGE_NAME) >/dev/null 2>&1
	@echo "Image removed"

# Default target
.DEFAULT_GOAL := help
