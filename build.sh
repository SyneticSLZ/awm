#!/usr/bin/env bash
# exit on error
set -o errexit

# Install required system dependencies for sqlite3
apt-get update -y
apt-get install -y build-essential python3

# Install dependencies with npm
npm install

# Build sqlite3 from source if needed
npm rebuild sqlite3 --build-from-source