# Уведомления по игровому контенту

Лицензия на код (`LICENSE`) не распространяется на правила настольных игр.
Правила принадлежат их издателям и используются по их собственным лицензиям.
Этот файл фиксирует, что именно уезжает в сборке и какие формулировки
обязательны, когда контент всё-таки распространяется.

## Что содержит публичная сборка

Публичная сборка (`dist:empty`, та, которую собирает CI и которая выкладывается
в GitHub Releases) **не содержит текста правил ни одной игровой системы**. При
первом запуске создаются только названия систем — «D&D 5.5», «Legend in the
Mist», «City of Mist», «Daggerheart» — как пустые контейнеры, которые Мастер
наполняет сам.

Сборка `dist:full` наполняется из рабочей базы владельца и наружу не
публикуется (см. «Красные линии» в `RELEASE.md`).

Отсюда правило: уведомления ниже обязательны не для самой программы, а для
**модулей** — файлов выгрузки систем и сеттингов, которые распространяются
отдельно, через каталог `soyman-modules` или иначе.

## D&D — SRD 5.2, CC BY 4.0

Материал System Reference Document 5.2 выпущен Wizards of the Coast под
лицензией Creative Commons Attribution 4.0 International. Использование, в том
числе коммерческое, разрешено при указании авторства. Лицензия безотзывна.

Модуль, содержащий материал SRD 5.2, обязан включать дословно:

> This work includes material from the System Reference Document 5.2 ("SRD
> 5.2") by Wizards of the Coast LLC, available at
> https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative
> Commons Attribution 4.0 International License, available at
> https://creativecommons.org/licenses/by/4.0/legalcode.

Никаких иных упоминаний Wizards of the Coast и её аффилированных лиц
добавлять нельзя — это условие самой лицензии.

**Вне SRD лицензии не существует.** Полные тексты Player's Handbook, Monster
Manual, Dungeon Master's Guide, приключений и любые их переводы на русский язык
не лицензируются ни для коммерческого, ни для бесплатного распространения:
Fan Content Policy покрывает только некоммерческие фанатские материалы и не даёт
права воспроизводить книги. Такие модули в каталог не принимаются.

## Daggerheart — DPCGL

Darrington Press Community Gaming License (редакция от 19.05.2025) допускает
создание материалов на основе Daggerheart SRD 1.0. Обязательные формулировки:

> This product includes materials from the Daggerheart System Reference
> Document 1.0, © Critical Role, LLC, under the terms of the Darrington Press
> Community Gaming License. More information at www.daggerheart.com.

> Darrington Press™ and the Darrington Press authorized work logo are
> trademarks of Critical Role, LLC and used with permission.

Запрещено копировать официальные иллюстрации, логотипы, карты и дословный текст
книг. **Перед выпуском модуля Daggerheart текст DPCGL нужно прочитать целиком** —
её условия по производному контенту и по платформам обсуждались публично, и для
программного инструмента, а не для книги, читаются неочевидно.

## Legend in the Mist и City of Mist — Cauldron of Mist

Программа Son of Oak Game Studio разрешает выпускать цифровые материалы на
движке Mist Engine: дополнения, карты, токены, профили опасностей и испытаний.
Крупные фрагменты книг копировать нельзя — вместо правил даётся отсылка на книгу
и страницу.

**Открытый вопрос:** программа описана под издательские материалы, а не под
программные инструменты. До выпуска модулей LitM или CoM нужно письменно
запросить Son of Oak, покрывает ли Cauldron of Mist использование внутри
приложения. Пока ответа нет, модули по этим системам наружу не выкладываются.

## Шрифты

Шрифты интерфейса (Anton, Oswald, Archivo, Cormorant SC, PT Serif, JetBrains
Mono и другие) распространяются под SIL Open Font License 1.1. Их тексты
лицензий лежат рядом со шрифтами и уезжают в сборке вместе с ними.

## Сторонние библиотеки

См. `THIRD-PARTY-LICENSES.md`.

## Ссылки

- SRD 5.2 и его лицензия: https://www.dndbeyond.com/srd
- CC BY 4.0: https://creativecommons.org/licenses/by/4.0/legalcode
- DPCGL: https://darringtonpress.com/license/
- Cauldron of Mist: https://help.drivethrurpg.com/hc/en-us/articles/12723253462295-Son-of-Oak-The-Cauldron-of-Mist-Content-Guidelines-FAQ
