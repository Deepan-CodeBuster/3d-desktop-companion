param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $phrases = @{
        'question.wav' = 'What is a rainbow?'
        'search.wav' = 'Open Google and search for cats.'
        'followup.wav' = 'Tell me more about that.'
        'wake-question.wav' = 'Hey Deep, open Google and search for cats.'
    }
    foreach ($entry in $phrases.GetEnumerator()) {
        $synth.SetOutputToWaveFile((Join-Path $Destination $entry.Key))
        $synth.Speak($entry.Value)
        $synth.SetOutputToNull()
    }
} finally {
    $synth.Dispose()
}
