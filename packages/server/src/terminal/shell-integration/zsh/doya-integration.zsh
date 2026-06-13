if [[ -n "${_DOYA_ZSH_INTEGRATION_LOADED-}" ]]; then
  return
fi
typeset -g _DOYA_ZSH_INTEGRATION_LOADED=1

autoload -Uz add-zsh-hook

typeset -g _DOYA_ZSH_COMMAND_ACTIVE=0

function _doya_osc633() {
  printf '\e]633;%s\a' "$1"
}

function _doya_precmd() {
  local command_status=$?
  if [[ "$_DOYA_ZSH_COMMAND_ACTIVE" == "1" ]]; then
    _doya_osc633 "D;${command_status}"
    _DOYA_ZSH_COMMAND_ACTIVE=0
  fi
  printf '\e]2;%s\a' "${PWD/#$HOME/~}"
  _doya_osc633 "A"
}

function _doya_preexec() {
  _DOYA_ZSH_COMMAND_ACTIVE=1
  _doya_osc633 "B"
  _doya_osc633 "C"
  printf '\e]2;%s\a' "$1"
}

add-zsh-hook precmd _doya_precmd
add-zsh-hook preexec _doya_preexec
