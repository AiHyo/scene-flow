#!/bin/bash
# Project-specific ast-grep rules. lint.sh treats any output as a failure.

ast-grep scan -r .rules/SelectItem.yml

ast-grep scan -r .rules/contrast.yml

ast-grep scan -r .rules/toast-hook.yml

ast-grep scan -r .rules/slot-nesting.yml

ast-grep scan -r .rules/require-button-interaction.yml

ast-grep scan -r .rules/no-csp-meta.yml
