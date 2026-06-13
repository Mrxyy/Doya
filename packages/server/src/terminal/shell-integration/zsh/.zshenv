typeset -g DOYA_SHELL_INTEGRATION_DIR="${${(%):-%N}:A:h}"

if [[ -n "${DOYA_ZSH_ZDOTDIR-}" ]]; then
  export ZDOTDIR="${DOYA_ZSH_ZDOTDIR}"
elif [[ -n "${DOYA_ZSH_ZDOTDIR-}" ]]; then
  export ZDOTDIR="${DOYA_ZSH_ZDOTDIR}"
else
  unset ZDOTDIR
fi

if [[ -n "${ZDOTDIR-}" ]]; then
  if [[ -f "${ZDOTDIR}/.zshenv" ]]; then
    source "${ZDOTDIR}/.zshenv"
  fi
elif [[ -f "${HOME}/.zshenv" ]]; then
  source "${HOME}/.zshenv"
fi

source "${DOYA_SHELL_INTEGRATION_DIR}/doya-integration.zsh"
