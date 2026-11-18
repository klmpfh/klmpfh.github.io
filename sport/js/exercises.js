/**
 * Sport – Übungsdatenbank und Konfigurations-Konstanten. Wird als erste App-Datei geladen.
 */
'use strict';

/* =====================================================================
 * ÜBUNGSDATENBANK
 * ---------------------------------------------------------------------
 * Neue Übung hinzufügen: einfach ein weiteres Objekt in das passende
 * Array-Segment einfügen. Felder:
 *   name        - Anzeigename
 *   category    - 'beine' | 'druecken' | 'ziehen' | 'core' | 'cardio'
 *                 (Drücken = Ellbogen strecken: Brust, Schulter,
 *                 Trizeps; Ziehen = Ellbogen beugen: Rücken, Bizeps;
 *                 Rückenstrecker zählen zu Core)
 *   type        - 'reps' (Sätze x Wiederholungen) oder 'time' (Sätze x Haltezeit)
 *   difficulty  - 'leicht' | 'mittel' | 'schwer' (steuert, ab welcher
 *                 Intensitätsstufe die Übung ins Training darf)
 *   muscles     - kurze Auflistung der trainierten Muskelgruppen, nur
 *                 echte Muskeln (erscheinen im Cool-down als Dehnliste),
 *                 z. B. "Quadrizeps", "Gesäß", "gerade Bauchmuskeln"
 *   description - kurze Ausführungsanleitung (2-3 Sätze, für sich
 *                 verständlich ohne Verweis auf andere Übungen):
 *                 Ausgangsposition. Bewegung. Ggf. Seitenwechsel mit
 *                 festen Formulierungen: "Seiten abwechseln." (jede
 *                 Wdh. andere Seite), "Wiederholungen je Seite." oder
 *                 bei Halteübungen "Zur Halbzeit Seite wechseln."
 *   equipment   - optional: Array benötigter Geräte-Codes
 *                 ('pullup' | 'bar' | 'elevated' | 'wall' | 'mat').
 *                 Fehlt das Feld, ist die Übung reine
 *                 Körpergewichtsübung ohne jedes Hilfsmittel.
 *   jump        - optional: true, wenn die Übung Sprünge/Hüpfen mit
 *                 Bodenaufprall enthält (laut, z. B. in
 *                 Mehrfamilienhäusern störend). Fehlt das Feld, kommt
 *                 die Übung ohne Sprünge/Hüpfen aus.
 *   scale       - optional: Faktor für Wiederholungen bzw. Haltezeit
 *                 gegenüber der Stufen-Vorgabe, z. B. 0.5 für
 *                 Klimmzüge oder 2 für Hampelmänner. Fehlt das Feld,
 *                 gilt 1.
 *   mobility    - nur Cardio/Mobility: Gruppen, die diese
 *                 Mobility-Übung beim Aufwärmen vorbereitet. Fehlt
 *                 das Feld, gilt die Übung beim Aufwärmen als
 *                 Puls-Übung.
 * ===================================================================== */
var EXERCISES = [
    // --- Beine & Gesäß --------------------------------------------------
    { name: "Kniebeugen", category: "beine", type: "reps", difficulty: "leicht", muscles: "Quadrizeps, Gesäß", description: "Füße schulterbreit, Rücken gerade. Hüfte nach hinten schieben und in die Knie gehen, bis die Oberschenkel waagrecht sind. Kraftvoll aufstehen." },
    { name: "Ausfallschritte", category: "beine", type: "reps", difficulty: "mittel", muscles: "Quadrizeps, Gesäß", description: "Großen Schritt nach vorne machen und das hintere Knie Richtung Boden senken, bis beide Knie etwa 90° gebeugt sind. Zurück in den Stand drücken. Seiten abwechseln." },
    { name: "Wandsitz", category: "beine", type: "time", difficulty: "mittel", muscles: "Quadrizeps, Gesäß", equipment: ["wall"], description: "Rücken an die Wand lehnen und nach unten rutschen, bis die Oberschenkel waagrecht sind – wie auf einem unsichtbaren Stuhl. Position halten." },
    { name: "Sumo-Kniebeugen", category: "beine", type: "reps", difficulty: "leicht", muscles: "Adduktoren, Gesäß, Quadrizeps", description: "Füße deutlich breiter als schulterbreit, Zehen leicht nach außen. In die Hocke gehen, die Knie zeigen dabei Richtung Zehen. Wieder aufstehen." },
    { name: "Kniebeugen-Sprünge", category: "beine", type: "reps", difficulty: "schwer", muscles: "Quadrizeps, Gesäß, Waden", jump: true, description: "Aus der Kniebeuge explosiv nach oben springen. Weich in den Knien landen und direkt in die nächste Kniebeuge gehen." },
    { name: "Bulgarische Ausfallschritte", category: "beine", type: "reps", difficulty: "schwer", muscles: "Quadrizeps, Gesäß", equipment: ["elevated"], description: "Hinteren Fuß auf eine Erhöhung (z. B. Stuhl) legen. Vorderes Bein beugen, bis das hintere Knie fast den Boden berührt, dann hochdrücken. Wiederholungen je Seite." },
    { name: "Hüftheben", category: "beine", type: "reps", difficulty: "leicht", muscles: "Gesäß, hintere Oberschenkel", equipment: ["mat"], description: "Rückenlage, Füße hüftbreit aufgestellt. Hüfte hochdrücken, bis Oberkörper und Oberschenkel eine gerade Linie bilden – kein Hohlkreuz. Kurz halten, langsam absenken." },
    { name: "Einbeiniges Hüftheben", category: "beine", type: "reps", difficulty: "mittel", muscles: "Gesäß, hintere Oberschenkel", equipment: ["mat"], description: "Rückenlage, ein Fuß aufgestellt, das andere Bein gestreckt in der Luft. Hüfte nur mit dem Standbein hochdrücken und langsam absenken. Wiederholungen je Seite." },
    { name: "Treppensteiger", category: "beine", type: "reps", difficulty: "mittel", muscles: "Quadrizeps, Gesäß", equipment: ["elevated"], description: "Mit einem Fuß auf eine stabile Erhöhung (Stufe, Bank) steigen und oben ganz aufrichten. Kontrolliert wieder heruntersteigen. Seiten abwechseln." },
    { name: "Wadenheben", category: "beine", type: "reps", difficulty: "leicht", muscles: "Waden", scale: 1.5, description: "Hüftbreit stehen. Langsam auf die Zehenspitzen drücken, oben kurz halten und kontrolliert absenken." },
    { name: "Knicks-Ausfallschritte", category: "beine", type: "reps", difficulty: "mittel", muscles: "Gesäß, Quadrizeps, Adduktoren", description: "Ein Bein schräg hinter das Standbein setzen und in die Knie gehen wie bei einem Knicks. Zurück in den Stand. Seiten abwechseln." },
    { name: "Einbeinige Kniebeuge (assistiert)", category: "beine", type: "reps", difficulty: "schwer", muscles: "Quadrizeps, Gesäß", scale: 0.6, description: "Auf einem Bein stehen, das andere nach vorne strecken. Langsam so tief wie möglich in die Hocke gehen und wieder aufstehen, bei Bedarf an Wand oder Möbel festhalten. Wiederholungen je Seite." },
    { name: "Rückwärts-Ausfallschritte", category: "beine", type: "reps", difficulty: "mittel", muscles: "Quadrizeps, Gesäß", description: "Großen Schritt nach hinten machen und das hintere Knie Richtung Boden senken, bis beide Knie etwa 90° gebeugt sind. Zurück in den Stand drücken. Seiten abwechseln." },
    { name: "Seitliche Kniebeugen", category: "beine", type: "reps", difficulty: "schwer", muscles: "Adduktoren, Quadrizeps, Gesäß", description: "Breiter Stand. Gewicht auf ein Bein verlagern und dieses tief beugen, das andere Bein bleibt gestreckt, Ferse am Boden. Seiten abwechseln." },
    { name: "Froschbrücke", category: "beine", type: "reps", difficulty: "leicht", muscles: "Gesäß, Adduktoren", equipment: ["mat"], description: "Rückenlage, Fußsohlen aneinander, Knie fallen nach außen. Hüfte hochdrücken, kurz halten und langsam absenken." },
    { name: "Einbeiniges Wadenheben", category: "beine", type: "reps", difficulty: "mittel", muscles: "Waden", scale: 1.2, description: "Auf einem Bein stehen, bei Bedarf leicht an der Wand festhalten. Langsam auf die Zehenspitze drücken und kontrolliert absenken. Wiederholungen je Seite." },
    { name: "Erhöhtes Abtreten", category: "beine", type: "reps", difficulty: "mittel", muscles: "Quadrizeps, Gesäß", equipment: ["elevated"], description: "Mit einem Bein auf einer Erhöhung stehen. Das andere Bein langsam nach vorne absenken, bis die Ferse fast den Boden berührt, dann wieder hochdrücken. Wiederholungen je Seite." },
    { name: "Erhöhtes Wadenheben", category: "beine", type: "reps", difficulty: "leicht", muscles: "Waden", equipment: ["elevated"], scale: 1.5, description: "Mit den Fußballen auf eine Stufenkante stellen. Fersen tief unter die Kante absenken, dann ganz auf die Zehenspitzen drücken." },
    { name: "Kniebeuge-Halten (hoch)", category: "beine", type: "time", difficulty: "leicht", muscles: "Quadrizeps, Gesäß", description: "Halbe Kniebeuge: Oberschenkel etwa auf halbem Weg nach unten, Rücken gerade. Position ruhig atmend halten." },
    { name: "Ausfallschritt-Halten (tief)", category: "beine", type: "time", difficulty: "schwer", muscles: "Quadrizeps, Gesäß", description: "In einen tiefen Ausfallschritt gehen, bis das hintere Knie knapp über dem Boden ist. Oberkörper aufrecht, Position halten. Zur Halbzeit Seite wechseln." },
    { name: "Knicks-Sprünge", category: "beine", type: "reps", difficulty: "schwer", muscles: "Gesäß, Quadrizeps, Adduktoren", jump: true, description: "Aus dem Knicks seitlich abspringen, auf dem anderen Bein landen und direkt in den Knicks zur anderen Seite gehen. Weich landen." },
    { name: "Einbeiniger Wandsitz", category: "beine", type: "time", difficulty: "schwer", muscles: "Quadrizeps, Gesäß", equipment: ["wall"], description: "Rücken an die Wand, Oberschenkel waagrecht wie beim Wandsitz. Ein Bein gestreckt nach vorne anheben und halten. Zur Halbzeit Seite wechseln." },
    { name: "Kniebeugen mit Pause", category: "beine", type: "reps", difficulty: "mittel", muscles: "Quadrizeps, Gesäß", description: "Füße schulterbreit, Rücken gerade. Tief in die Kniebeuge gehen, unten 2 Sekunden halten, dann kraftvoll aufstehen." },
    { name: "Einbeiniges Kreuzheben", category: "beine", type: "reps", difficulty: "mittel", muscles: "hintere Oberschenkel, Gesäß", description: "Auf einem Bein stehen, Knie leicht gebeugt. Oberkörper mit geradem Rücken nach vorne kippen und das andere Bein nach hinten heben, bis beide fast waagrecht sind. Aufrichten. Wiederholungen je Seite." },
    { name: "Seitliches Beinheben", category: "beine", type: "reps", difficulty: "leicht", muscles: "Abduktoren, Gesäß", equipment: ["mat"], scale: 1.5, description: "Seitlich liegen, Kopf auf dem unteren Arm, Beine gestreckt. Oberes Bein gestreckt anheben, Fußspitze zeigt nach vorne, langsam absenken. Wiederholungen je Seite." },
    { name: "Ausfallschritt-Sprünge", category: "beine", type: "reps", difficulty: "schwer", muscles: "Quadrizeps, Gesäß, Waden", jump: true, description: "Aus dem Ausfallschritt explosiv hochspringen, in der Luft die Beine wechseln und weich im Ausfallschritt mit dem anderen Bein vorne landen." },
    { name: "Hüftheben-Halten", category: "beine", type: "time", difficulty: "leicht", muscles: "Gesäß, hintere Oberschenkel", equipment: ["mat"], description: "Rückenlage, Füße hüftbreit aufgestellt. Hüfte hochdrücken, bis Oberkörper und Oberschenkel eine gerade Linie bilden – kein Hohlkreuz. Po fest anspannen und oben halten." },
    { name: "Seitschritt-Kniebeugen", category: "beine", type: "reps", difficulty: "leicht", muscles: "Quadrizeps, Gesäß, Adduktoren", description: "Großen Schritt zur Seite machen und dabei in die Kniebeuge gehen. Beim Aufstehen den Fuß wieder heranziehen. Seiten abwechseln." },
    { name: "Rumpfvorbeuge", category: "beine", type: "reps", difficulty: "mittel", muscles: "unterer Rücken, hintere Oberschenkel, Gesäß", description: "Stehen, Hände hinter dem Kopf, Knie leicht gebeugt. Oberkörper mit geradem Rücken aus der Hüfte nach vorne kippen und wieder aufrichten." },
    { name: "Standwaage", category: "beine", type: "time", difficulty: "schwer", muscles: "unterer Rücken, Gesäß, hintere Oberschenkel", description: "Auf einem Bein stehen. Oberkörper nach vorne kippen und das andere Bein nach hinten heben, bis Arme, Rumpf und Bein eine waagrechte Linie bilden. Halten, zur Halbzeit Seite wechseln." },

    // --- Ziehen (Rücken/Bizeps) -----------------------------------------
    { name: "Rückwärts-Schneeengel", category: "ziehen", type: "reps", difficulty: "leicht", muscles: "oberer Rücken, Schultern", equipment: ["mat"], description: "Bauchlage, Arme neben dem Körper, Stirn knapp über dem Boden. Arme knapp über dem Boden seitlich bis über den Kopf führen und wieder zurück." },
    { name: "Y-T-W-Heben", category: "ziehen", type: "reps", difficulty: "mittel", muscles: "oberer Rücken, Schultern", equipment: ["mat"], description: "Bauchlage, Stirn knapp über dem Boden. Arme nacheinander als Y (schräg nach vorne), T (zur Seite) und W (Ellbogen gebeugt) anheben und dabei die Schulterblätter zusammenziehen. Y-T-W zählt als eine Wiederholung." },
    { name: "Klimmzüge", category: "ziehen", type: "reps", difficulty: "schwer", muscles: "breiter Rücken, Bizeps", equipment: ["pullup"], scale: 0.5, description: "An der Stange hängen, Handflächen zeigen nach vorne, Hände etwas breiter als schulterbreit. Hochziehen, bis das Kinn über der Stange ist, dann langsam absenken." },
    { name: "Enge Klimmzüge (Untergriff)", category: "ziehen", type: "reps", difficulty: "mittel", muscles: "breiter Rücken, Bizeps", equipment: ["pullup"], scale: 0.5, description: "An der Stange hängen, Handflächen zeigen zum Gesicht, Hände schulterbreit. Hochziehen, bis das Kinn über der Stange ist, dann langsam absenken." },
    { name: "Negative Klimmzüge", category: "ziehen", type: "reps", difficulty: "mittel", muscles: "breiter Rücken, Bizeps", equipment: ["pullup"], scale: 0.35, description: "Mit Sprung oder Hocker in die obere Position kommen (Kinn über der Stange). Dann so langsam wie möglich bis zu gestreckten Armen absenken." },
    { name: "Hängendes Schulterblatt-Ziehen", category: "ziehen", type: "reps", difficulty: "leicht", muscles: "oberer Rücken, breiter Rücken", equipment: ["pullup"], description: "Mit gestreckten Armen an der Stange hängen. Schultern nach unten ziehen, sodass der Körper ein Stück hochkommt – die Arme bleiben gestreckt. Langsam wieder lösen." },
    { name: "Inverses Rudern", category: "ziehen", type: "reps", difficulty: "mittel", muscles: "oberer Rücken, breiter Rücken, Bizeps", equipment: ["bar"], description: "Unter eine hüfthohe Stange legen und sie schulterbreit greifen. Körper gerade wie ein Brett, Brust zur Stange ziehen und langsam absenken." },
    { name: "Einarmiges Inverses Rudern", category: "ziehen", type: "reps", difficulty: "schwer", muscles: "oberer Rücken, breiter Rücken, Bizeps, Rumpf", equipment: ["bar"], scale: 0.6, description: "Unter eine hüfthohe Stange legen und sie mit einer Hand greifen. Körper gerade halten, ohne zu verdrehen, Brust zur Stange ziehen und langsam absenken. Wiederholungen je Seite." },
    { name: "Y-Heben im Stand", category: "ziehen", type: "reps", difficulty: "leicht", muscles: "oberer Rücken, Schultern", description: "Knie leicht gebeugt, Oberkörper mit geradem Rücken weit nach vorne neigen. Arme schräg nach oben zu einem Y heben, Schulterblätter zusammenziehen, langsam absenken." },
    { name: "Reverse Fly im Stand", category: "ziehen", type: "reps", difficulty: "mittel", muscles: "oberer Rücken, Schultern", description: "Knie leicht gebeugt, Oberkörper mit geradem Rücken weit nach vorne neigen. Arme leicht gebeugt seitlich bis auf Schulterhöhe öffnen, Schulterblätter zusammenziehen, langsam zurückführen." },
    { name: "Toter Hang", category: "ziehen", type: "time", difficulty: "leicht", muscles: "breiter Rücken, Unterarme", equipment: ["pullup"], description: "Mit gestreckten Armen schulterbreit an der Stange hängen, die Füße sind frei. Schultern leicht nach unten ziehen und ruhig hängen bleiben." },
    { name: "Klimmzug-Halten (oben)", category: "ziehen", type: "time", difficulty: "schwer", muscles: "breiter Rücken, Bizeps", equipment: ["pullup"], scale: 0.5, description: "Hochziehen oder mit Hocker hochsteigen, bis das Kinn über der Stange ist. Diese Position halten, Schultern bleiben unten." },
    { name: "Inverses Rudern mit gebeugten Knien", category: "ziehen", type: "reps", difficulty: "leicht", muscles: "oberer Rücken, breiter Rücken, Bizeps", equipment: ["bar"], description: "Unter eine hüfthohe Stange legen, Knie gebeugt, Füße aufgestellt. Stange schulterbreit greifen, Hüfte gestreckt lassen, Brust zur Stange ziehen und langsam absenken." },
    { name: "W-Ziehen im Stand", category: "ziehen", type: "reps", difficulty: "leicht", muscles: "oberer Rücken, breiter Rücken", description: "Arme gestreckt nach oben. Ellbogen nach unten zu den Rippen ziehen, sodass die Arme ein W bilden, und die Schulterblätter zusammendrücken. Wieder hochstrecken." },
    { name: "Bauchlage-Latziehen", category: "ziehen", type: "reps", difficulty: "mittel", muscles: "breiter Rücken, oberer Rücken", equipment: ["mat"], description: "Bauchlage, Arme nach vorne gestreckt und leicht angehoben. Ellbogen zu den Rippen ziehen, als würde eine Stange zur Brust gezogen, und wieder nach vorne strecken. Arme bleiben in der Luft." },
    { name: "Skispringer-Halten", category: "ziehen", type: "time", difficulty: "mittel", muscles: "unterer Rücken, oberer Rücken, hintere Oberschenkel", description: "Knie leicht gebeugt, Oberkörper mit geradem Rücken weit nach vorne neigen. Arme gestreckt nach hinten neben die Hüfte führen, Schulterblätter zusammenziehen und halten." },
    { name: "Isometrischer Bizeps-Zug", category: "ziehen", type: "time", difficulty: "leicht", muscles: "Bizeps, Unterarme", description: "Hände vor dem Bauch ineinanderhaken, die untere Handfläche zeigt nach oben, Ellbogen 90° gebeugt. Der untere Arm zieht kräftig nach oben, der obere hält mit gleicher Kraft dagegen. Zur Halbzeit Hände tauschen." },
    { name: "Bein-Curl im Sitzen", category: "ziehen", type: "reps", difficulty: "mittel", muscles: "Bizeps, Unterarme", description: "Aufrecht sitzen, beide Hände von unten in eine Kniekehle greifen. Das Bein schwer machen und mit den Armen langsam Richtung Brust ziehen, das Bein bremst dagegen. Langsam ablassen. Wiederholungen je Seite." },
    { name: "Bauchlage-Latziehen mit Halten", category: "ziehen", type: "reps", difficulty: "schwer", muscles: "breiter Rücken, oberer Rücken", equipment: ["mat"], description: "Bauchlage, Brust und gestreckte Arme leicht angehoben. Ellbogen kräftig zu den Rippen ziehen, Schulterblätter zusammendrücken und 2 Sekunden halten. Wieder nach vorne strecken, die Arme bleiben in der Luft." },

    // --- Drücken (Brust/Schulter/Trizeps) --------------------------------
    { name: "Liegestütze", category: "druecken", type: "reps", difficulty: "mittel", muscles: "Brust, Schultern, Trizeps", equipment: ["mat"], description: "Hände etwas breiter als schulterbreit, Körper gerade von Kopf bis Fuß. Brust bis knapp über den Boden senken und wieder hochdrücken." },
    { name: "Knie-Liegestütze", category: "druecken", type: "reps", difficulty: "leicht", muscles: "Brust, Schultern, Trizeps", equipment: ["mat"], description: "Auf Händen und Knien abstützen, Hände etwas breiter als schulterbreit, Körper gerade von Kopf bis Knie. Brust zum Boden senken und hochdrücken." },
    { name: "Diamant-Liegestütze", category: "druecken", type: "reps", difficulty: "schwer", muscles: "Trizeps, Brust, Schultern", equipment: ["mat"], description: "Liegestützposition, Hände unter der Brust zusammen, Daumen und Zeigefinger bilden eine Raute. Brust zu den Händen senken und hochdrücken, Ellbogen eng am Körper." },
    { name: "Breite Liegestütze", category: "druecken", type: "reps", difficulty: "mittel", muscles: "Brust, Schultern", equipment: ["mat"], description: "Liegestützposition mit Händen deutlich breiter als schulterbreit. Brust zum Boden senken und hochdrücken." },
    { name: "Spitzwinkel-Liegestütze", category: "druecken", type: "reps", difficulty: "schwer", muscles: "Schultern, Trizeps", equipment: ["mat"], description: "Aus der Liegestützposition den Po hochschieben, bis der Körper ein umgekehrtes V bildet. Ellbogen beugen, Kopf Richtung Boden senken und hochdrücken." },
    { name: "Trizeps-Stützen (Stuhl)", category: "druecken", type: "reps", difficulty: "mittel", muscles: "Trizeps, Schultern", equipment: ["elevated"], description: "Rücken zum Stuhl, Hände auf der Sitzkante, Beine nach vorne gestreckt. Ellbogen nach hinten beugen, Po absenken und wieder hochdrücken." },
    { name: "Bogenschützen-Liegestütze", category: "druecken", type: "reps", difficulty: "schwer", muscles: "Brust, Trizeps, Schultern", equipment: ["mat"], scale: 0.6, description: "Liegestützposition mit sehr breiten Händen. Zu einer Seite absenken, der andere Arm bleibt gestreckt, dann hochdrücken. Seiten abwechseln." },
    { name: "Schräge Liegestütze (erhöht)", category: "druecken", type: "reps", difficulty: "leicht", muscles: "Brust, Schultern", equipment: ["elevated"], description: "Hände auf eine Erhöhung (Couch, Stufe, Tisch) stützen, Körper gerade. Brust zur Kante senken und hochdrücken – leichter als am Boden." },
    { name: "Liegestütze mit erhöhten Füßen", category: "druecken", type: "reps", difficulty: "schwer", muscles: "Brust, Schultern, Trizeps", equipment: ["elevated", "mat"], description: "Füße auf eine Erhöhung legen, Hände am Boden etwas breiter als schulterbreit. Brust zum Boden senken und hochdrücken." },
    { name: "Stützwechsel", category: "druecken", type: "reps", difficulty: "mittel", muscles: "Trizeps, Brust, Rumpf", equipment: ["mat"], description: "Unterarmstütz. Hand für Hand in die Liegestützposition hochdrücken und wieder zurück auf die Unterarme. Den führenden Arm abwechseln." },
    { name: "Wand-Liegestütze", category: "druecken", type: "reps", difficulty: "leicht", muscles: "Brust, Schultern, Trizeps", equipment: ["wall"], description: "Etwa einen Schritt vor der Wand stehen, Hände schulterhoch an die Wand. Brust zur Wand senken und wieder wegdrücken." },
    { name: "Schulterblatt-Liegestütze", category: "druecken", type: "reps", difficulty: "leicht", muscles: "Schultern, Brust", equipment: ["mat"], description: "Liegestützposition, die Arme bleiben gestreckt. Brust leicht absinken lassen, bis sich die Schulterblätter berühren, dann den oberen Rücken rund nach oben drücken." },
    { name: "Tauch-Liegestütze", category: "druecken", type: "reps", difficulty: "mittel", muscles: "Brust, Schultern, Trizeps", equipment: ["mat"], description: "Start im umgekehrten V (Po hoch). Brust in einem Bogen dicht über dem Boden nach vorne schieben und den Oberkörper aufrichten. Den Po wieder nach hinten oben drücken." },
    { name: "Knie-Ellbogen-Liegestütze", category: "druecken", type: "reps", difficulty: "schwer", muscles: "Brust, Trizeps, schräge Bauchmuskeln", equipment: ["mat"], description: "Liegestütze, dabei beim Absenken ein Knie seitlich zum Ellbogen derselben Seite ziehen und beim Hochdrücken zurückstellen. Seiten abwechseln." },
    { name: "Spitzwinkel-Liegestütze mit erhöhten Füßen", category: "druecken", type: "reps", difficulty: "schwer", muscles: "Schultern, Trizeps", equipment: ["elevated", "mat"], scale: 0.6, description: "Füße auf eine Erhöhung, Hände am Boden, Po hoch, sodass der Oberkörper möglichst senkrecht ist. Kopf Richtung Boden senken und hochdrücken." },
    { name: "Wand-Handstand-Halten", category: "druecken", type: "time", difficulty: "schwer", muscles: "Schultern, Trizeps, Rumpf", equipment: ["wall"], scale: 0.7, description: "Bauch zur Wand: Hände vor der Wand aufsetzen und mit den Füßen an der Wand hochlaufen, so weit es sicher geht. Körper gerade, Position halten." },
    { name: "Wand-Liegestütz-Halten", category: "druecken", type: "time", difficulty: "leicht", muscles: "Brust, Schultern, Trizeps", equipment: ["wall"], description: "Hände schulterhoch an die Wand, Körper gerade. Brust zur Wand senken und in der unteren Position halten." },
    { name: "Liegestütz-Halten (Mitte)", category: "druecken", type: "time", difficulty: "mittel", muscles: "Brust, Schultern, Trizeps, Rumpf", equipment: ["mat"], description: "Liegestützposition, Arme halb beugen (Ellbogen etwa 90°) und dort halten. Der Körper bleibt gerade." },
    { name: "Liegestütz-Halten (unten)", category: "druecken", type: "time", difficulty: "schwer", muscles: "Brust, Trizeps, Schultern, Rumpf", equipment: ["mat"], description: "Liegestützposition, Brust bis knapp über den Boden senken und dort halten, ohne abzulegen. Der Körper bleibt gerade." },
    { name: "Isometrisches Handdrücken", category: "druecken", type: "time", difficulty: "leicht", muscles: "Brust, Schultern", description: "Handflächen vor der Brust aneinanderlegen, Ellbogen auf Brusthöhe. Hände so fest wie möglich gegeneinander pressen und halten." },
    { name: "Seitheben-Halten", category: "druecken", type: "time", difficulty: "mittel", muscles: "Schultern", description: "Arme seitlich gestreckt auf Schulterhöhe heben (T-Form), Schultern locker unten lassen. Ruhig atmend halten." },
    { name: "Überkopf-Halten", category: "druecken", type: "time", difficulty: "leicht", muscles: "Schultern, Trizeps", description: "Arme gestreckt senkrecht über den Kopf heben, Bauch anspannen, kein Hohlkreuz. Position halten." },
    { name: "Trizeps-Pulse im Stand", category: "druecken", type: "reps", difficulty: "mittel", muscles: "Trizeps", scale: 2, description: "Oberkörper leicht vorneigen, Arme gestreckt hinter den Körper, Handflächen zeigen nach hinten. Arme in kleinen Pulsen nach oben drücken." },
    { name: "Langsame Liegestütze", category: "druecken", type: "reps", difficulty: "schwer", muscles: "Brust, Schultern, Trizeps", equipment: ["mat"], scale: 0.7, description: "Liegestützposition. Brust in 3 Sekunden absenken, kurz über dem Boden halten und zügig hochdrücken." },
    { name: "Enge Knie-Liegestütze", category: "druecken", type: "reps", difficulty: "leicht", muscles: "Trizeps, Brust", equipment: ["mat"], description: "Auf Händen und Knien abstützen, Hände schulterbreit unter der Brust, Körper gerade. Ellbogen eng am Körper beugen, Brust senken und hochdrücken." },
    { name: "Trizeps-Stützen (Boden)", category: "druecken", type: "reps", difficulty: "leicht", muscles: "Trizeps, Schultern", equipment: ["mat"], description: "Sitzen, Füße aufgestellt, Hände hinter dem Po, Finger zeigen zu den Füßen. Po leicht anheben, Ellbogen nach hinten beugen und wieder strecken." },
    { name: "Sphinx-Liegestütze", category: "druecken", type: "reps", difficulty: "schwer", muscles: "Trizeps, Schultern", equipment: ["mat"], description: "Unterarmstütz, Ellbogen unter den Schultern. Hände in den Boden drücken, bis die Ellbogen abheben und die Arme gestreckt sind, dann langsam zurück auf die Unterarme." },
    { name: "Spitzwinkel-Halten", category: "druecken", type: "time", difficulty: "mittel", muscles: "Schultern, Trizeps", equipment: ["mat"], description: "Umgekehrtes V: Hände und Füße am Boden, Po hoch, Arme gestreckt, Kopf zwischen den Armen. Gewicht deutlich auf die Hände verlagern und halten." },
    { name: "Seitheben-Pulse", category: "druecken", type: "reps", difficulty: "mittel", muscles: "Schultern", scale: 2, description: "Arme seitlich gestreckt auf Schulterhöhe heben. In kleinen Pulsen auf und ab bewegen, Schultern bleiben locker unten." },

    // --- Core / Rumpf -----------------------------------------------------
    { name: "Unterarmstütz", category: "core", type: "time", difficulty: "leicht", muscles: "Rumpf, Schultern", equipment: ["mat"], description: "Auf Unterarmen und Zehenspitzen abstützen, Ellbogen unter den Schultern. Körper gerade von Kopf bis Ferse, Bauch und Po anspannen und halten." },
    { name: "Seitlicher Unterarmstütz", category: "core", type: "time", difficulty: "mittel", muscles: "schräge Bauchmuskeln, Rumpf", equipment: ["mat"], description: "Seitlich auf einem Unterarm abstützen, Ellbogen unter der Schulter, Beine gestreckt. Hüfte anheben, bis der Körper gerade ist, und halten. Zur Halbzeit Seite wechseln." },
    { name: "Bauchpressen", category: "core", type: "reps", difficulty: "leicht", muscles: "gerade Bauchmuskeln", equipment: ["mat"], description: "Rückenlage, Füße aufgestellt, Fingerspitzen an den Schläfen. Kopf und Schultern einrollend anheben, der untere Rücken bleibt am Boden. Langsam absenken." },
    { name: "Fahrrad-Bauchpressen", category: "core", type: "reps", difficulty: "mittel", muscles: "gerade Bauchmuskeln, schräge Bauchmuskeln", equipment: ["mat"], scale: 1.5, description: "Rückenlage, Fingerspitzen an den Schläfen, Beine angehoben. Rechten Ellbogen zum linken Knie führen und das andere Bein strecken. Seiten abwechseln wie beim Radfahren." },
    { name: "Beinheben", category: "core", type: "reps", difficulty: "mittel", muscles: "gerade Bauchmuskeln, Hüftbeuger", equipment: ["mat"], description: "Rückenlage, Beine gestreckt, Hände unter dem Po. Beine bis senkrecht anheben und langsam absenken, ohne den Boden zu berühren." },
    { name: "Bergsteiger", category: "core", type: "reps", difficulty: "mittel", muscles: "Rumpf, Hüftbeuger, Schultern", equipment: ["mat"], scale: 2, description: "Liegestützposition. Knie abwechselnd zügig zur Brust ziehen, die Hüfte bleibt tief und ruhig." },
    { name: "Russische Drehungen", category: "core", type: "reps", difficulty: "mittel", muscles: "schräge Bauchmuskeln", equipment: ["mat"], scale: 1.5, description: "Sitzen, Oberkörper leicht zurückgelehnt, Füße vom Boden abheben. Hände vor der Brust falten und den Oberkörper abwechselnd nach links und rechts drehen." },
    { name: "Hohlkörper-Halten", category: "core", type: "time", difficulty: "schwer", muscles: "gerade Bauchmuskeln, tiefe Bauchmuskeln", equipment: ["mat"], description: "Rückenlage, unteren Rücken fest in den Boden drücken. Arme über den Kopf strecken, Schultern und gestreckte Beine knapp über dem Boden halten." },
    { name: "Schultertippen im Stütz", category: "core", type: "reps", difficulty: "mittel", muscles: "Rumpf, Schultern", equipment: ["mat"], scale: 1.5, description: "Liegestützposition, Füße etwas breiter. Mit einer Hand die gegenüberliegende Schulter antippen, die Hüfte möglichst ruhig halten. Seiten abwechseln." },
    { name: "Klappmesser", category: "core", type: "reps", difficulty: "schwer", muscles: "gerade Bauchmuskeln, Hüftbeuger", equipment: ["mat"], description: "Rückenlage, Arme über dem Kopf, Beine gestreckt. Oberkörper und Beine gleichzeitig anheben und mit den Händen Richtung Füße greifen. Langsam ablegen." },
    { name: "Toter Käfer", category: "core", type: "reps", difficulty: "leicht", muscles: "tiefe Bauchmuskeln, gerade Bauchmuskeln", equipment: ["mat"], description: "Rückenlage, Arme zur Decke, Knie 90° gebeugt über der Hüfte. Einen Arm und das gegenüberliegende Bein langsam Richtung Boden strecken, der untere Rücken bleibt am Boden. Seiten abwechseln." },
    { name: "Beinschlagen", category: "core", type: "reps", difficulty: "mittel", muscles: "gerade Bauchmuskeln, Hüftbeuger", equipment: ["mat"], scale: 2, description: "Rückenlage, Hände unter dem Po, gestreckte Beine knapp über dem Boden. Beine im Wechsel in kleinen, schnellen Bewegungen auf und ab schlagen." },
    { name: "Zehenheber", category: "core", type: "reps", difficulty: "leicht", muscles: "gerade Bauchmuskeln", equipment: ["mat"], description: "Rückenlage, Beine gestreckt senkrecht nach oben. Arme zu den Zehen strecken und dabei die Schultern vom Boden heben, langsam absenken." },
    { name: "Stütz-Hampelmann", category: "core", type: "reps", difficulty: "mittel", muscles: "Rumpf, Schultern, Adduktoren", equipment: ["mat"], jump: true, scale: 1.5, description: "Liegestützposition. Die Füße mit kleinen Sprüngen auseinander und wieder zusammen springen, der Rumpf bleibt fest." },
    { name: "Hüftsenken im Seitstütz", category: "core", type: "reps", difficulty: "mittel", muscles: "schräge Bauchmuskeln, Rumpf", equipment: ["mat"], description: "Seitlicher Unterarmstütz. Hüfte langsam Richtung Boden senken und wieder anheben, ohne abzulegen. Wiederholungen je Seite." },
    { name: "Hängendes Knieheben", category: "core", type: "reps", difficulty: "mittel", muscles: "gerade Bauchmuskeln, Hüftbeuger, Unterarme", equipment: ["pullup"], scale: 0.8, description: "An der Stange hängen. Knie langsam zur Brust ziehen, kurz halten und ohne Schwung absenken." },
    { name: "Hängendes Beinheben", category: "core", type: "reps", difficulty: "schwer", muscles: "gerade Bauchmuskeln, Hüftbeuger, Unterarme", equipment: ["pullup"], scale: 0.6, description: "An der Stange hängen. Gestreckte Beine bis auf Hüfthöhe anheben, kurz halten und ohne Schwung absenken." },
    { name: "Hängender Scheibenwischer", category: "core", type: "reps", difficulty: "schwer", muscles: "schräge Bauchmuskeln, Hüftbeuger, Unterarme", equipment: ["pullup"], scale: 0.6, description: "An der Stange hängen und die Knie auf Hüfthöhe anziehen. Beine langsam nach links und rechts schwenken, der Oberkörper bleibt ruhig." },
    { name: "Toter-Käfer-Halten", category: "core", type: "time", difficulty: "leicht", muscles: "tiefe Bauchmuskeln, gerade Bauchmuskeln", equipment: ["mat"], description: "Rückenlage, Arme zur Decke, Knie 90° gebeugt. Einen Arm und das gegenüberliegende Bein knapp über dem Boden ausstrecken und halten, der untere Rücken bleibt am Boden. Zur Halbzeit Seite wechseln." },
    { name: "Beinheben-Halten", category: "core", type: "time", difficulty: "mittel", muscles: "gerade Bauchmuskeln, Hüftbeuger", equipment: ["mat"], description: "Rückenlage, Hände unter dem Po. Gestreckte Beine etwa eine Handbreit über den Boden heben und halten, der untere Rücken bleibt am Boden." },
    { name: "V-Sitz-Halten", category: "core", type: "time", difficulty: "schwer", muscles: "gerade Bauchmuskeln, Hüftbeuger", equipment: ["mat"], scale: 0.7, description: "Auf dem Po balancieren, Oberkörper und gestreckte Beine anheben, sodass der Körper ein V bildet. Arme nach vorne strecken und halten. Leichter: Knie anwinkeln." },
    { name: "Stehender Diagonal-Crunch", category: "core", type: "reps", difficulty: "mittel", muscles: "schräge Bauchmuskeln, Hüftbeuger", description: "Stehen, Fingerspitzen an den Schläfen. Ein Knie anheben und den gegenüberliegenden Ellbogen dazu führen. Seiten abwechseln." },
    { name: "Seitliche Rumpfbeugen im Stand", category: "core", type: "reps", difficulty: "leicht", muscles: "schräge Bauchmuskeln", description: "Hüftbreit stehen, Arme locker am Körper. Oberkörper langsam zur Seite neigen, ohne nach vorne zu kippen. Seiten abwechseln." },
    { name: "Bauch-Vakuum", category: "core", type: "time", difficulty: "mittel", muscles: "tiefe Bauchmuskeln", description: "Aufrecht stehen und vollständig ausatmen. Bauchnabel so weit wie möglich nach innen ziehen und halten, dabei flach weiteratmen." },
    { name: "Stehendes Knieheben mit Halten", category: "core", type: "time", difficulty: "leicht", muscles: "Hüftbeuger, gerade Bauchmuskeln", description: "Aufrecht stehen, ein Knie auf Hüfthöhe anheben und halten, der Oberkörper bleibt gerade. Zur Halbzeit Seite wechseln." },
    { name: "Unterarmstütz mit Beinheben", category: "core", type: "reps", difficulty: "mittel", muscles: "Rumpf, Gesäß", equipment: ["mat"], description: "Unterarmstütz, Körper gerade. Ein gestrecktes Bein anheben, kurz halten und absenken, die Hüfte bleibt ruhig. Seiten abwechseln." },
    { name: "Seitstütz auf den Knien", category: "core", type: "time", difficulty: "leicht", muscles: "schräge Bauchmuskeln", equipment: ["mat"], description: "Seitlich auf einem Unterarm abstützen, Knie 90° gebeugt. Hüfte vom Boden abheben, bis der Körper von Kopf bis Knie gerade ist und die Hüfte nicht durchhängt, und halten. Zur Halbzeit Seite wechseln." },
    { name: "Rückwärts-Crunch", category: "core", type: "reps", difficulty: "mittel", muscles: "gerade Bauchmuskeln", equipment: ["mat"], description: "Rückenlage, Arme neben dem Körper, Knie 90° gebeugt über der Hüfte. Becken einrollen und die Knie Richtung Brust ziehen, langsam zurück." },
    { name: "Stütz-Rotation", category: "core", type: "reps", difficulty: "schwer", muscles: "schräge Bauchmuskeln, Schultern, Rumpf", equipment: ["mat"], description: "Liegestützposition. Körper zur Seite aufdrehen und einen Arm zur Decke strecken (T-Form), dann zurück. Seiten abwechseln." },
    { name: "Bärenstand-Halten", category: "core", type: "time", difficulty: "mittel", muscles: "Rumpf, Quadrizeps, Schultern", equipment: ["mat"], description: "Vierfüßlerstand, Zehen aufgestellt. Knie eine Handbreit vom Boden abheben, Rücken gerade, und halten." },
    { name: "Holzhacker im Stand", category: "core", type: "reps", difficulty: "leicht", muscles: "schräge Bauchmuskeln, Schultern", description: "Hände gefaltet über einer Schulter. Arme diagonal zum gegenüberliegenden Knie ziehen und dabei leicht in die Knie gehen, der Oberkörper dreht mit. Wiederholungen je Seite." },
    { name: "Rumpfheber (Halten)", category: "core", type: "time", difficulty: "leicht", muscles: "unterer Rücken, Gesäß", equipment: ["mat"], description: "Bauchlage, Arme nach vorne gestreckt. Arme, Oberkörper und Beine gleichzeitig leicht anheben und halten, Blick zum Boden." },
    { name: "Rumpfheber (Pulsierend)", category: "core", type: "reps", difficulty: "mittel", muscles: "unterer Rücken, Gesäß, Schultern", equipment: ["mat"], scale: 2, description: "Bauchlage, Arme nach vorne gestreckt. Arme, Oberkörper und Beine leicht anheben und oben in kleinen, schnellen Bewegungen auf und ab wippen." },
    { name: "Rückenstrecker", category: "core", type: "reps", difficulty: "mittel", muscles: "unterer Rücken", equipment: ["mat"], description: "Bauchlage, Fingerspitzen an den Schläfen. Oberkörper langsam anheben, kurz halten und kontrolliert absenken. Die Füße bleiben am Boden." },
    { name: "Diagonalheben (Vierfüßlerstand)", category: "core", type: "reps", difficulty: "leicht", muscles: "unterer Rücken, Gesäß, Rumpf", equipment: ["mat"], description: "Vierfüßlerstand. Rechten Arm und linkes Bein gleichzeitig waagrecht strecken, kurz halten und zurückführen. Seiten abwechseln." },
    { name: "Heuschrecke (Pulsierend)", category: "core", type: "reps", difficulty: "schwer", muscles: "unterer Rücken, Gesäß, Schultern", equipment: ["mat"], scale: 1.5, description: "Bauchlage, Arme neben dem Körper, Handflächen nach oben. Brust und Beine anheben und oben in kleinen, schnellen Pulsen weiter nach oben drücken." },
    { name: "Schwimmer", category: "core", type: "reps", difficulty: "mittel", muscles: "unterer Rücken, Gesäß, Schultern", equipment: ["mat"], scale: 2, description: "Bauchlage, Arme und Beine gestreckt und leicht angehoben. Rechten Arm und linkes Bein im Wechsel mit der Gegenseite auf und ab bewegen, flüssig wie beim Schwimmen." },
    { name: "Kobra-Dehnhalten", category: "core", type: "time", difficulty: "leicht", muscles: "unterer Rücken, gerade Bauchmuskeln", equipment: ["mat"], description: "Bauchlage, Hände unter den Schultern. Oberkörper mit den Armen hochdrücken, das Becken bleibt am Boden. Ruhig atmend halten." },
    { name: "Rückwärts-Brücke", category: "core", type: "time", difficulty: "mittel", muscles: "unterer Rücken, Gesäß, hintere Oberschenkel, Schultern", equipment: ["mat"], description: "Sitzen mit gestreckten Beinen, Hände hinter dem Po, Finger zeigen zu den Füßen. Hüfte hochdrücken, bis der Körper eine gerade Linie bildet, und halten." },
    { name: "Diagonalhalten (Vierfüßlerstand)", category: "core", type: "time", difficulty: "mittel", muscles: "unterer Rücken, Gesäß, Rumpf", equipment: ["mat"], description: "Vierfüßlerstand. Rechten Arm und linkes Bein waagrecht strecken und ruhig halten, der Rücken bleibt gerade. Zur Halbzeit Seite wechseln." },
    { name: "Superman-Halten (volle Streckung)", category: "core", type: "time", difficulty: "schwer", muscles: "unterer Rücken, Gesäß, Schultern", equipment: ["mat"], description: "Bauchlage, Arme nach vorne gestreckt. Arme, Oberkörper und Beine so hoch wie möglich anheben und die Spannung halten." },

    // --- Cardio / Mobility (Aufwärmen & Finisher) -------------------------
    { name: "Hampelmänner", category: "cardio", type: "reps", difficulty: "leicht", muscles: "Waden, Adduktoren, Schultern", jump: true, scale: 2, description: "Mit einem Sprung die Beine grätschen und die Arme über den Kopf führen. Zurück in die Ausgangsposition springen." },
    { name: "Hohe Knie", category: "cardio", type: "reps", difficulty: "mittel", muscles: "Hüftbeuger, Quadrizeps, Waden", scale: 2, description: "Auf der Stelle laufen und die Knie abwechselnd mindestens auf Hüfthöhe ziehen. Die Arme schwingen mit." },
    { name: "Armkreisen", category: "cardio", type: "time", difficulty: "leicht", muscles: "Schultern", mobility: ["druecken", "ziehen"], description: "Arme seitlich ausstrecken und gleichmäßig kreisen, erst klein, dann größer. Zur Halbzeit die Richtung wechseln." },
    { name: "Hüftkreisen", category: "cardio", type: "time", difficulty: "leicht", muscles: "Hüftbeuger, unterer Rücken", mobility: ["beine", "core"], description: "Hände in die Hüften, Füße hüftbreit. Becken in großen, ruhigen Kreisen bewegen. Zur Halbzeit die Richtung wechseln." },
    { name: "Anfersen", category: "cardio", type: "reps", difficulty: "mittel", muscles: "hintere Oberschenkel, Waden", scale: 2, description: "Auf der Stelle laufen und die Fersen abwechselnd zügig zum Po führen." },
    { name: "Ausfallschritte mit Rotation", category: "cardio", type: "reps", difficulty: "mittel", muscles: "Quadrizeps, Gesäß, schräge Bauchmuskeln", mobility: ["beine", "core"], description: "Großen Schritt nach vorne in den Ausfallschritt. Oberkörper zur Seite des vorderen Beins drehen, zurückdrehen und in den Stand. Seiten abwechseln." },
    { name: "Großer Hüftöffner", category: "cardio", type: "reps", difficulty: "mittel", muscles: "Hüftbeuger, Gesäß, oberer Rücken", mobility: ["beine"], description: "Tiefer Ausfallschritt, beide Hände innen neben dem vorderen Fuß. Ellbogen Richtung Boden senken, dann denselben Arm zur Decke aufdrehen und hinterherschauen. Wiederholungen je Seite." },
    { name: "Seilspringen (ohne Seil)", category: "cardio", type: "time", difficulty: "mittel", muscles: "Waden", jump: true, description: "Auf den Fußballen in kleinen, schnellen Sprüngen hüpfen und die Handgelenke kreisen, als würde ein Seil schwingen." },
    { name: "Raupengang", category: "cardio", type: "reps", difficulty: "mittel", muscles: "hintere Oberschenkel, Schultern, Rumpf", equipment: ["mat"], mobility: ["beine", "druecken", "core"], description: "Aus dem Stand vorbeugen, Hände auf den Boden und nach vorne laufen bis in die Liegestützposition. Mit den Händen zurücklaufen und aufrichten." },
    { name: "Katze-Kuh", category: "cardio", type: "reps", difficulty: "leicht", muscles: "unterer Rücken, oberer Rücken", equipment: ["mat"], mobility: ["core", "ziehen"], description: "Vierfüßlerstand. Beim Ausatmen den Rücken rund nach oben drücken (Katze), beim Einatmen sanft ins Hohlkreuz sinken (Kuh)." },
    { name: "Schlittschuhsprünge", category: "cardio", type: "reps", difficulty: "schwer", muscles: "Gesäß, Quadrizeps, Adduktoren", jump: true, scale: 1.5, description: "Seitlich von einem Bein aufs andere springen, das freie Bein hinter dem Standbein kreuzen. Weich landen und kurz stabilisieren." },
    { name: "Kniebeugen mit Armkreisen", category: "cardio", type: "reps", difficulty: "leicht", muscles: "Quadrizeps, Gesäß, Schultern", mobility: ["beine", "druecken"], description: "Langsame Kniebeugen machen und dabei die Arme gleichmäßig nach vorne kreisen." },
    { name: "Liegestütz-Strecksprung", category: "cardio", type: "reps", difficulty: "schwer", muscles: "Brust, Quadrizeps, Gesäß", equipment: ["mat"], jump: true, description: "Hocke, Hände auf den Boden, Füße nach hinten in die Liegestützposition springen. Einen Liegestütz machen, Füße zurück zu den Händen springen und mit einem Strecksprung abschließen." },
    { name: "Grätschsprünge mit Kniebeuge", category: "cardio", type: "reps", difficulty: "mittel", muscles: "Quadrizeps, Gesäß, Adduktoren", jump: true, description: "Mit einem Sprung die Beine weit grätschen und in eine Kniebeuge absinken. Wieder hochspringen und mit geschlossenen Füßen landen." },
    { name: "Seitliches Knieheben im Stand", category: "cardio", type: "reps", difficulty: "leicht", muscles: "schräge Bauchmuskeln, Hüftbeuger", scale: 1.5, description: "Stehen, Fingerspitzen an den Schläfen. Ein Knie seitlich hochziehen und mit dem Ellbogen derselben Seite antippen. Zügig Seiten abwechseln." },
    { name: "Schulterkreisen", category: "cardio", type: "time", difficulty: "leicht", muscles: "Schultern, oberer Rücken", mobility: ["druecken", "ziehen"], description: "Locker stehen, Arme hängen lassen. Schultern in großen Kreisen nach hinten bewegen, zur Halbzeit nach vorne." },
    { name: "Sprungbereitschafts-Halten", category: "cardio", type: "time", difficulty: "schwer", muscles: "Quadrizeps, Gesäß, Waden", description: "Füße hüftbreit, Knie und Hüfte gebeugt, Gewicht auf den Fußballen, Arme vor dem Körper – wie ein Torwart. Die Position halten und dabei schnell auf der Stelle trippeln." },
    { name: "Wandengel", category: "cardio", type: "reps", difficulty: "leicht", muscles: "oberer Rücken, Schultern", equipment: ["wall"], mobility: ["ziehen", "druecken"], description: "Rücken, Kopf und Arme an die Wand lehnen, Ellbogen 90° gebeugt. Arme an der Wand langsam nach oben schieben und wieder herunterziehen, ohne den Kontakt zu verlieren." },
    { name: "Cardio-Steigen", category: "cardio", type: "time", difficulty: "mittel", muscles: "Quadrizeps, Gesäß, Waden", equipment: ["elevated"], description: "Zügig im Wechsel auf eine stabile Erhöhung steigen und wieder herunter. Ein gleichmäßig flottes Tempo halten." },
    { name: "Schattenboxen", category: "cardio", type: "time", difficulty: "mittel", muscles: "Schultern, schräge Bauchmuskeln", description: "Locker federnd stehen, Fäuste vor dem Gesicht. Abwechselnd zügig nach vorne boxen, der Oberkörper dreht leicht mit." },
    { name: "Leise Hampelmänner", category: "cardio", type: "reps", difficulty: "leicht", muscles: "Adduktoren, Schultern", scale: 2, description: "Abwechselnd einen Fuß zur Seite setzen und dabei die Arme über den Kopf führen, dann zurück. Zügiges Tempo, ohne zu springen." },
    { name: "Leise Burpees", category: "cardio", type: "reps", difficulty: "mittel", muscles: "Quadrizeps, Brust, Schultern", equipment: ["mat"], description: "Hocke, Hände auf den Boden, Füße nacheinander nach hinten in die Liegestützposition setzen. Füße nacheinander zurückholen, aufstehen und die Arme nach oben strecken." },
    { name: "Sternsprünge", category: "cardio", type: "reps", difficulty: "schwer", muscles: "Quadrizeps, Gesäß, Waden", jump: true, description: "Aus der Hocke explosiv hochspringen und Arme und Beine in der Luft zu einem Stern spreizen. Weich in der Hocke landen." },
    { name: "Beinpendel", category: "cardio", type: "reps", difficulty: "leicht", muscles: "Hüftbeuger, hintere Oberschenkel", equipment: ["wall"], mobility: ["beine"], description: "Seitlich an der Wand abstützen. Ein Bein locker nach vorne und hinten schwingen und den Schwung langsam vergrößern. Wiederholungen je Seite." },
    { name: "Vierfüßler-Rotation", category: "cardio", type: "reps", difficulty: "leicht", muscles: "oberer Rücken, schräge Bauchmuskeln", equipment: ["mat"], mobility: ["core", "ziehen"], description: "Vierfüßlerstand, eine Hand an die Schläfe. Ellbogen unter dem Körper zur Gegenseite führen, dann nach oben zur Decke aufdrehen, der Blick folgt. Wiederholungen je Seite." }
];

/* Anzeige-Metadaten je Kategorie: Label und Badge-Farbe. */
var CATEGORY_META = {
    beine:    { label: "Beine &amp; Gesäß",                   color: "#2f9e44" },
    druecken: { label: "Drücken (Brust/Schulter/Trizeps)",    color: "#e8590c" },
    ziehen:   { label: "Ziehen (Rücken/Bizeps)",              color: "#1971c2" },
    core:     { label: "Core / Rumpf",                        color: "#9c36b5" },
    cardio:   { label: "Cardio/Mobility",                     color: "#0c8599" }
};
var CATEGORY_ORDER = ["beine", "druecken", "ziehen", "core", "cardio"];

/* Anzeige-Metadaten je Geräte-Code. */
var EQUIPMENT_META = {
    pullup:   { label: "Klimmzugstange" },
    bar:      { label: "Abgehängte Stange" },
    elevated: { label: "Erhöhte Fläche" },
    wall:     { label: "Wand zum Anlehnen" },
    mat:      { label: "Sportmatte" }
};

/* Je Intensitätsstufe (1-5): Wiederholungs-/Haltezeit-Basis sowie
 * erlaubter Schwierigkeitspool für die Übungsauswahl. Gilt pro Übung
 * (siehe levels/balancedLevel), skaliert mit ihrem scale-Faktor. */
var INTENSITY_CONFIG = {
    1: { repsMin: 6,  repsMax: 8,  holdSec: 15, pool: ["leicht"] },
    2: { repsMin: 8,  repsMax: 10, holdSec: 20, pool: ["leicht", "mittel"] },
    3: { repsMin: 10, repsMax: 14, holdSec: 30, pool: ["leicht", "mittel"] },
    4: { repsMin: 12, repsMax: 16, holdSec: 40, pool: ["mittel", "schwer"] },
    5: { repsMin: 14, repsMax: 20, holdSec: 45, pool: ["mittel", "schwer"] }
};

/* Pause nach einem Satz in Sekunden: je anstrengender der Satz
 * (Gesamtwert aus Schwierigkeit und Stufe, 1-5), desto länger -
 * von 25 Sek. (Wert 1) bis 60 Sek. (Wert 5). Cardio ist
 * Konditionstraining und kommt mit 15-30 Sek. aus. Im Supersatz gilt
 * die längere der beiden Pausen, und zwar erst nach beiden Übungen. */
var REST_CONFIG = {
    strength: { base: 15, perPoint: 9 },
    cardio:   { base: 10, perPoint: 4 }
};
var INTENSITY_LABELS = { 1: "sehr leicht", 2: "leicht", 3: "mittel", 4: "anspruchsvoll", 5: "sehr intensiv" };

/* Umfang des ganzen Trainings je Intensität: Gesamtzahl der
 * Arbeitssätze und Übungen im Hauptteil. Orientiert an gängigen
 * Richtwerten für ein Ganzkörpertraining (ca. 6-10 Übungen, 2-4 Sätze
 * je Übung, 15-30+ Sätze gesamt), damit "mittel" unabhängig von der
 * Gruppenauswahl ungefähr gleich anstrengend bleibt. Die Sätze werden
 * gleichmäßig verteilt (Schwerpunkt-Gruppen bekommen den Rest zuerst),
 * je Übung zwischen SETS_MIN und SETS_MAX. */
var VOLUME_CONFIG = {
    1: { totalSets: 12, exercises: 6 },
    2: { totalSets: 18, exercises: 7 },
    3: { totalSets: 24, exercises: 8 },
    4: { totalSets: 30, exercises: 9 },
    5: { totalSets: 36, exercises: 10 }
};
var SETS_MIN = 2;
var SETS_MAX = 4;

/* Ab wann eine höhere Intensität empfohlen wird: Anteil der anhebbaren
 * Übungen einer Gruppe, die angehoben sein müssen, und die Mindestzahl
 * dafür (siehe recommendedIntensity). */
var RECOMMEND_RAISED_SHARE = 0.25;
var RECOMMEND_RAISED_MIN = 2;

/* Muskelgruppen-Zustände: Gewicht für die Verteilung der Übungen. */
var GROUP_STATES = ["off", "normal", "focus"];
var GROUP_WEIGHT = { off: 0, normal: 1, focus: 2 };
var DEFAULT_GROUP_STATES = { beine: "normal", druecken: "normal", ziehen: "normal", core: "normal", cardio: "normal" };

var COOLDOWN_MIN = 5;
