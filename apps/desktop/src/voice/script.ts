// The speech helper run by Windows PowerShell 5.1 (it ships with Windows, and so does System.Speech,
// the offline recognizer). One JSON object per line each way. It listens only when asked, for one
// utterance, and keeps nothing: no audio is saved and nothing leaves the PC.
//
// In:  {"op":"grammar","id":1,"phrases":["three B apps",…],"question":"coach"}
//      {"op":"listen","id":2}            the default microphone
//      {"op":"listen","id":3,"file":"x.wav"}   a WAV file (tests)
//      {"op":"quit"}
// Out: {"ev":"ready","culture":"en-US","cultures":[…]} once, then per request
//      {"ev":"grammar","id":1,"count":412} · {"ev":"heard","id":2,"text":"…","confidence":0.93,"grammar":"phrases"}
//      {"ev":"none","id":2} · {"ev":"error","id":2,"error":"…"}

export const HELPER_FILE = 'csbot-voice.ps1';

export const HELPER_PS1 = String.raw`
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
function Send($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
try { Add-Type -AssemblyName System.Speech } catch { Send @{ ev = 'error'; error = 'Windows speech recognition is not available on this PC.' }; exit 1 }
$cultures = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object { $_.Culture.Name })
$culture = $env:CSBOT_VOICE_CULTURE
if (-not $culture) { $culture = 'en-US' }
if ($cultures -notcontains $culture) { Send @{ ev = 'error'; error = ('No ' + $culture + ' speech recognizer on this PC (Windows Settings, Time and language, Speech).'); cultures = $cultures }; exit 1 }
$ci = [System.Globalization.CultureInfo]$culture
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine $ci
$engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(4)
$engine.BabbleTimeout = [TimeSpan]::FromSeconds(8)
$engine.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(500)
$engine.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(900)
$mic = $false
$quit = $false
Send @{ ev = 'ready'; culture = $culture; cultures = $cultures }
while (-not $quit) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $m = $null
  try {
    $m = $line | ConvertFrom-Json
    if ($m.op -eq 'grammar') {
      $engine.UnloadAllGrammars()
      $choices = New-Object System.Speech.Recognition.Choices
      foreach ($p in $m.phrases) { [void]$choices.Add([string]$p) }
      $gb = New-Object System.Speech.Recognition.GrammarBuilder
      $gb.Culture = $ci
      $gb.Append($choices)
      $g = New-Object System.Speech.Recognition.Grammar $gb
      $g.Name = 'phrases'
      $engine.LoadGrammar($g)
      if ($m.question) {
        $qb = New-Object System.Speech.Recognition.GrammarBuilder
        $qb.Culture = $ci
        $qb.Append([string]$m.question)
        $qb.AppendDictation()
        $q = New-Object System.Speech.Recognition.Grammar $qb
        $q.Name = 'question'
        $engine.LoadGrammar($q)
      }
      Send @{ ev = 'grammar'; id = $m.id; count = @($m.phrases).Count }
    } elseif ($m.op -eq 'listen') {
      if ($m.file) { $engine.SetInputToWaveFile([string]$m.file); $mic = $false }
      elseif (-not $mic) { $engine.SetInputToDefaultAudioDevice(); $mic = $true }
      $r = $engine.Recognize()
      if ($m.file) { $engine.SetInputToNull() }
      if ($r) { Send @{ ev = 'heard'; id = $m.id; text = $r.Text; confidence = [math]::Round($r.Confidence, 3); grammar = $r.Grammar.Name } }
      else { Send @{ ev = 'none'; id = $m.id } }
    } elseif ($m.op -eq 'quit') {
      $quit = $true
    }
  } catch {
    $msg = $_.Exception.Message
    if ($msg -match 'audio input|audio device') { $msg = 'No microphone found (Windows sound settings).' }
    Send @{ ev = 'error'; id = $(if ($m) { $m.id } else { $null }); error = $msg }
  }
}
$engine.Dispose()
`;
