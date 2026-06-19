%% gunadarma-la.cls
%% LaTeX Class untuk Laporan Akhir Praktikum Universitas Gunadarma

\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{gunadarma-la}[2026/02/02 Gunadarma LA Praktikum Class v1.0]

%% Base class
\LoadClass[12pt,a4paper]{article}

%% Packages
\RequirePackage[T1]{fontenc}
\RequirePackage[utf8]{inputenc}
\RequirePackage{newtxtext,newtxmath}
\RequirePackage[a4paper,top=3cm,bottom=3cm,left=3cm,right=3cm]{geometry}
\RequirePackage{setspace}
\onehalfspacing
\RequirePackage[indonesian]{babel}
\RequirePackage{graphicx}
\RequirePackage{float}
\RequirePackage{array}
\RequirePackage{booktabs}
\RequirePackage{listings}
\RequirePackage{xcolor}
\RequirePackage{titlesec}
\RequirePackage{parskip}

%% Paragraph indent
\setlength{\parindent}{1.25cm}

%% Section formatting - 14pt Bold
\titleformat{\section}{\normalfont\fontsize{14}{16}\bfseries}{\thesection}{1em}{}
\titleformat{\subsection}{\normalfont\fontsize{12}{14}\bfseries}{\thesubsection}{1em}{}
\setcounter{secnumdepth}{0}

%% Code listing style
\definecolor{codebg}{RGB}{248,248,248}
\definecolor{codeframe}{RGB}{200,200,200}
\lstset{
	basicstyle=\ttfamily\small,
	backgroundcolor=\color{codebg},
	frame=single,
	rulecolor=\color{codeframe},
	breaklines=true,
	tabsize=4,
	showstringspaces=false,
	numbers=left,
	numberstyle=\tiny\color{gray},
	numbersep=8pt,
	xleftmargin=15pt,
	framexleftmargin=15pt
}

%% Data mahasiswa commands
\newcommand{\nama}[1]{\def\@nama{#1}}
\newcommand{\npm}[1]{\def\@npm{#1}}
\newcommand{\kelas}[1]{\def\@kelas{#1}}
\newcommand{\praktikumke}[1]{\def\@praktikumke{#1}}
\newcommand{\tanggal}[1]{\def\@tanggal{#1}}
\newcommand{\materi}[1]{\def\@materi{#1}}
\newcommand{\ketuaasisten}[1]{\def\@ketuaasisten{#1}}
\newcommand{\matakuliah}[1]{\def\@matakuliah{#1}}
\newcommand{\tahun}[1]{\def\@tahun{#1}}

%% Default values
\nama{[Nama]}
\npm{[NPM]}
\kelas{[Kelas]}
\praktikumke{[X]}
\tanggal{[Tanggal]}
\materi{[Materi]}
\ketuaasisten{[Asisten]}
\matakuliah{}
\tahun{\the\year}

%% Header page command
\newcommand{\halamanHeader}{
	\begin{center}
		{\fontsize{14}{18}\bfseries LAPORAN AKHIR PRAKTIKUM}
		\vspace{1cm}
	\end{center}

	\noindent
	\fontsize{14}{21}\selectfont  % 14pt font, 1.5 line spacing (14 * 1.5 = 21)
	\begin{tabular}{@{}p{4cm}p{0.5cm}p{10cm}@{}}
		\textbf{Nama} & \textbf{:} & \textbf{\@nama} \\[6pt]
		\textbf{Kelas} & \textbf{:} & \textbf{\@kelas} \\[6pt]
		\textbf{Mata Kuliah} & \textbf{:} & \textbf{\@matakuliah} \\[6pt]
		\textbf{Praktikum ke} & \textbf{:} & \textbf{\@praktikumke} \\[6pt]
		\textbf{Tanggal} & \textbf{:} & \textbf{\@tanggal} \\[6pt]
		\textbf{Materi} & \textbf{:} & \textbf{\@materi} \\[6pt]
		\textbf{NPM} & \textbf{:} & \textbf{\@npm} \\[6pt]
		\textbf{Ketua Asisten} & \textbf{:} & \textbf{\@ketuaasisten} \\
	\end{tabular}
	\normalsize\normalfont  % reset font size

	\vfill

	\begin{center}
		\includegraphics[width=4cm]{logo-gunadarma.png}
		
		\vspace{0.5cm}
		
		{\fontsize{14}{21}\selectfont
		\textbf{LABORATORIUM INFORMATIKA}\\
		\textbf{UNIVERSITAS GUNADARMA}\\
		\textbf{\@tahun}
		}
	\end{center}

	\newpage
}

%% Section commands
\newcommand{\sectionListing}{
	\section{LISTING}
	\vspace{0.5cm}
	\begin{center}
		\textit{[Screenshot kode akan ditambahkan di sini]}
	\end{center}
	\newpage
}

\newcommand{\sectionLogika}{\section{LOGIKA}}

\newcommand{\sectionOutput}{
	\newpage
	\section{OUTPUT}
	\vspace{0.5cm}
	\begin{center}
		\textit{[Screenshot output akan ditambahkan di sini]}
	\end{center}
}

\endinput
