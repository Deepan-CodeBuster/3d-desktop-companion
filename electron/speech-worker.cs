using System;
using System.Collections.Generic;
using System.Globalization;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Threading;
using System.Web.Script.Serialization;

public static class DeepSpeechWorker
{
    private static readonly object OutputLock = new object();
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 8000000 };
    private static readonly ManualResetEventSlim RecognitionStopped = new ManualResetEventSlim(true);
    private static SpeechRecognitionEngine Recognizer;
    private static volatile bool Listening;
    private static volatile int ActiveToken;
    private static volatile string Mode = "paused";
    private static long LastLevelUpdate;

    private static void Write(object value)
    {
        lock (OutputLock) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }
    }

    private static void Result(RecognitionResult result)
    {
        if (!Listening) return;
        int token = ActiveToken;
        if (Mode != "command")
        {
            if (result != null) Write(new { type = "recognized", token = token, text = result.Text,
                confidence = result.Confidence, wav = result.Text.Length > 9 ? Audio(result) : null });
            return;
        }
        string wav = Audio(result);
        if (wav != null) Write(new { type = "audio", token = token, wav = wav });
        else Write(new { type = "rejected", token = token });
    }

    private static string Audio(RecognitionResult result)
    {
        if (result == null || result.Audio == null) return null;
        using (System.IO.MemoryStream audio = new System.IO.MemoryStream())
        {
            result.Audio.WriteToWaveStream(audio);
            if (audio.Length > 44 && audio.Length <= 4000000)
                return Convert.ToBase64String(audio.ToArray());
            return null;
        }
    }

    private static Grammar WakeGrammar(CultureInfo culture)
    {
        GrammarBuilder builder = new GrammarBuilder();
        builder.Culture = culture;
        builder.Append("hey deep");
        GrammarBuilder suffix = new GrammarBuilder();
        suffix.Culture = culture;
        suffix.AppendDictation();
        builder.Append(suffix, 0, 1);
        Grammar grammar = new Grammar(builder);
        grammar.Name = "wake";
        grammar.Weight = 1.0f;
        return grammar;
    }

    private static RecognizerInfo EnglishRecognizer()
    {
        // Prefer the user's installed English locale before falling back.
        foreach (RecognizerInfo info in SpeechRecognitionEngine.InstalledRecognizers())
            if (info.Culture.Name == CultureInfo.CurrentCulture.Name && info.Culture.TwoLetterISOLanguageName == "en") return info;
        foreach (RecognizerInfo info in SpeechRecognitionEngine.InstalledRecognizers())
            if (info.Culture.Name == "en-US") return info;
        foreach (RecognizerInfo info in SpeechRecognitionEngine.InstalledRecognizers())
            if (info.Culture.TwoLetterISOLanguageName == "en") return info;
        throw new InvalidOperationException("Install an English Windows speech recognition language pack to use Hey Deep. You can still type messages.");
    }

    public static void Probe()
    {
        RecognizerInfo info = EnglishRecognizer();
        using (SpeechRecognitionEngine recognizer = new SpeechRecognitionEngine(info))
        using (SpeechSynthesizer synth = new SpeechSynthesizer())
        {
            recognizer.LoadGrammar(WakeGrammar(info.Culture));
            recognizer.LoadGrammar(new DictationGrammar());
            Write(new { type = "probe", culture = info.Culture.Name, voices = synth.GetInstalledVoices().Count, grammar = "Hey Deep plus optional command" });
        }
    }

    public static void SelfTest()
    {
        RecognizerInfo info = EnglishRecognizer();
        using (SpeechRecognitionEngine recognizer = new SpeechRecognitionEngine(info))
        using (SpeechSynthesizer synth = new SpeechSynthesizer())
        {
            Grammar wake = WakeGrammar(info.Culture);
            DictationGrammar conversation = new DictationGrammar();
            recognizer.LoadGrammar(wake);
            recognizer.LoadGrammar(conversation);
            string[] phrases = { "Hey Deep open Google and search for cats", "What is a rainbow", "Tell me more about that" };
            for (int turn = 0; turn < phrases.Length; turn++)
            {
                wake.Enabled = turn == 0;
                conversation.Enabled = turn != 0;
                using (System.IO.MemoryStream audio = new System.IO.MemoryStream())
                {
                    synth.SetOutputToWaveStream(audio);
                    synth.Speak(phrases[turn]);
                    synth.SetOutputToNull();
                    audio.Position = 0;
                    recognizer.SetInputToWaveStream(audio);
                    RecognitionResult result = recognizer.Recognize(TimeSpan.FromSeconds(15));
                    if (result == null) throw new InvalidOperationException("Speech self-test turn " + turn + " did not recognize the generated audio.");
                    Write(new { type = "self-test", turn = turn, text = result.Text, confidence = result.Confidence });
                    recognizer.SetInputToNull();
                }
            }
        }
    }

    private static void Pause()
    {
        if (Recognizer == null || !Listening) return;
        Listening = false;
        Recognizer.RecognizeAsyncCancel();
        if (!RecognitionStopped.Wait(3000)) throw new TimeoutException("The microphone did not stop in time.");
    }

    private static void Listen()
    {
        if (Recognizer == null || Listening) return;
        RecognitionStopped.Reset();
        Listening = true;
        try { Recognizer.RecognizeAsync(RecognizeMode.Multiple); }
        catch { Listening = false; RecognitionStopped.Set(); throw; }
    }

    public static void Run()
    {
        Console.InputEncoding = new System.Text.UTF8Encoding(false);
        Console.OutputEncoding = new System.Text.UTF8Encoding(false);
        string recognitionError = "";
        string culture = "";
        try
        {
            try
            {
                RecognizerInfo info = EnglishRecognizer();
                culture = info.Culture.Name;
                Recognizer = new SpeechRecognitionEngine(info);
                Grammar wake = WakeGrammar(info.Culture);
                Recognizer.LoadGrammar(wake);
                DictationGrammar dictation = new DictationGrammar();
                dictation.Name = "conversation";
                dictation.Weight = 0.6f;
                dictation.Enabled = false;
                Recognizer.LoadGrammar(dictation);
                Recognizer.EndSilenceTimeout = TimeSpan.FromMilliseconds(1300);
                Recognizer.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(1700);
                Recognizer.InitialSilenceTimeout = TimeSpan.Zero;
                Recognizer.BabbleTimeout = TimeSpan.Zero;
                Recognizer.SpeechRecognized += delegate(object sender, SpeechRecognizedEventArgs e)
                {
                    Result(e.Result);
                };
                Recognizer.SpeechHypothesized += delegate(object sender, SpeechHypothesizedEventArgs e)
                {
                    if (Listening) Write(new { type = "partial", token = ActiveToken, text = e.Result.Text });
                };
                Recognizer.SpeechRecognitionRejected += delegate(object sender, SpeechRecognitionRejectedEventArgs e)
                {
                    if (Mode == "command") Result(e.Result);
                };
                Recognizer.AudioLevelUpdated += delegate(object sender, AudioLevelUpdatedEventArgs e)
                {
                    long now = DateTime.UtcNow.Ticks;
                    if (Listening && now - LastLevelUpdate >= TimeSpan.TicksPerMillisecond * 120)
                    {
                        LastLevelUpdate = now;
                        Write(new { type = "level", token = ActiveToken, level = e.AudioLevel });
                    }
                };
                Recognizer.AudioSignalProblemOccurred += delegate(object sender, AudioSignalProblemOccurredEventArgs e)
                {
                    if (Listening) Write(new { type = "signal", token = ActiveToken, problem = e.AudioSignalProblem.ToString() });
                };
                Recognizer.RecognizeCompleted += delegate(object sender, RecognizeCompletedEventArgs e)
                {
                    Listening = false;
                    RecognitionStopped.Set();
                    if (e.Error != null) Write(new { type = "error", error = e.Error.Message });
                };
                Recognizer.SetInputToDefaultAudioDevice();
            }
            catch (Exception error)
            {
                recognitionError = "Microphone / Windows speech: " + error.Message;
                if (Recognizer != null) { Recognizer.Dispose(); Recognizer = null; }
            }

            Write(new { type = "ready", recognitionAvailable = Recognizer != null, speechAvailable = false,
                culture = culture, error = recognitionError });
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                try
                {
                    Dictionary<string, object> command = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(line);
                    string type = Convert.ToString(command["type"]);
                    if (type == "mode")
                    {
                        int id = Convert.ToInt32(command["id"]);
                        string mode = Convert.ToString(command["mode"]);
                        try
                        {
                            if (Recognizer == null) throw new InvalidOperationException("The microphone is unavailable.");
                            Pause();
                            foreach (Grammar grammar in Recognizer.Grammars)
                                grammar.Enabled = grammar.Name == "wake" ? mode == "wake" : mode == "command";
                            ActiveToken = id;
                            Mode = mode;
                            if (mode != "paused") Listen();
                            Write(new { type = "mode-set", id = id, mode = mode });
                        }
                        catch (Exception error) { Write(new { type = "mode-set", id = id, mode = mode, error = error.Message }); }
                    }
                    else if (type == "quit") break;
                }
                catch (Exception error) { Write(new { type = "error", error = error.Message }); }
            }
        }
        catch (Exception error) { Write(new { type = "error", error = error.Message }); }
        finally
        {
            if (Recognizer != null) { Pause(); Recognizer.Dispose(); }
        }
    }
}
